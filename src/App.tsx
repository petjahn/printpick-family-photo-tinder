import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { User } from 'firebase/auth';
import { Layers, LayoutGrid, Plus, User as UserIcon, Camera } from 'lucide-react';
import { CandidatePhoto, PhotoRecord, PhotoStatus, RuntimeConfig, UndoAction } from './types';
import { isFirebaseConfigured, loadRuntimeConfig, saveRuntimeConfig } from './services/config';
import {
  bulkRemovePhotoRecords,
  bulkUpdatePhotoStatus,
  getStoredAccessToken,
  removePhotoRecord,
  signInWithGoogleAndPhotosScope,
  signOutUser,
  storeAccessToken,
  subscribeAuthState,
  subscribeFamilyPhotos,
  upsertPhotoRecord,
} from './services/firebase';
import {
  createPickerSession,
  listPickedMediaItems,
  pollPickerSessionUntilReady,
} from './services/googlePhotos';
import { generateDemoCandidates } from './services/demoData';
import { SwipeView } from './components/SwipeView';
import { AdminTab, AdminView } from './components/AdminView';
import { ConfigModal } from './components/ConfigModal';

type AppMode = 'swipe' | 'admin';

export const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>(() =>
    window.location.hash === '#admin' ? 'admin' : 'swipe'
  );
  const [adminInitialTab, setAdminInitialTab] = useState<AdminTab>('print');
  const [config, setConfig] = useState<RuntimeConfig>(() => loadRuntimeConfig());
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string>(() => getStoredAccessToken());
  const [records, setRecords] = useState<Record<string, PhotoRecord>>({});
  const [candidates, setCandidates] = useState<CandidatePhoto[]>([]);
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [pickerLoadingText, setPickerLoadingText] = useState('');
  const [toastError, setToastError] = useState('');

  const switchMode = useCallback((nextMode: AppMode, tab?: AdminTab) => {
    if (tab) setAdminInitialTab(tab);
    setMode(nextMode);
    window.location.hash = nextMode;
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      if (window.location.hash === '#admin') setMode('admin');
      else if (window.location.hash === '#swipe') setMode('swipe');
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Auth listener
  useEffect(() => {
    const unsubAuth = subscribeAuthState(config, (u) => setUser(u));
    return () => unsubAuth();
  }, [config]);

  const isAuthenticated = Boolean(user);

  // Subscribe to family photos (Firestore when authenticated, local mirror before sign-in)
  useEffect(() => {
    const unsubPhotos = subscribeFamilyPhotos(
      config,
      isAuthenticated,
      (map) => setRecords(map),
      (err) => setToastError(err.message)
    );
    return () => unsubPhotos();
  }, [config, isAuthenticated]);

  const loadDemoRoll = useCallback(async (resetSwipedSamples = false) => {
    const demoItems = await generateDemoCandidates();
    if (resetSwipedSamples && demoItems.length > 0) {
      const sampleIds = demoItems.map((d) => d.id);
      setRecords((prev) => {
        const next = { ...prev };
        for (const id of sampleIds) delete next[id];
        return next;
      });
      await bulkRemovePhotoRecords(config, isAuthenticated, sampleIds).catch(() => {});
    }
    setCandidates((prev) => {
      const nonSample = prev.filter((p) => !p.id.startsWith('sample_'));
      return [...demoItems, ...nonSample];
    });
  }, [config, isAuthenticated]);

  useEffect(() => {
    loadDemoRoll(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unseenQueue = useMemo(
    () => candidates.filter((c) => !records[c.id]),
    [candidates, records]
  );

  const counts = useMemo(() => {
    const list = Object.values(records);
    return {
      print: list.filter((r) => r.status === 'print').length,
      delete: list.filter((r) => r.status === 'delete').length,
      shown: list.filter((r) => r.status === 'shown' || r.status === 'printed').length,
    };
  }, [records]);

  const handleGoogleSignIn = async (): Promise<string> => {
    setToastError('');
    if (!isFirebaseConfigured(config)) {
      setShowConfigModal(true);
      return '';
    }
    try {
      const res = await signInWithGoogleAndPhotosScope(config);
      setUser(res.user);
      if (res.accessToken) {
        setAccessToken(res.accessToken);
      }
      return res.accessToken;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setToastError(msg);
      return '';
    }
  };

  const handleOpenGooglePicker = async () => {
    setToastError('');
    let token = accessToken;
    if (!token) {
      token = await handleGoogleSignIn();
    }
    if (!token) {
      return;
    }

    try {
      setPickerLoadingText('Opening Google Photos...');
      const session = await createPickerSession(token);
      window.open(session.pickerUri, '_blank', 'width=980,height=740');

      await pollPickerSessionUntilReady(session.id, token, (msg) => setPickerLoadingText(msg));
      setPickerLoadingText('Importing your selected photos...');
      const picked = await listPickedMediaItems(session.id, token, (msg) =>
        setPickerLoadingText(msg)
      );

      // Update fresh 60-minute baseUrl for any already-marked photos (e.g. Refresh Links in Admin)
      for (const item of picked) {
        const existing = records[item.id];
        if (existing && item.baseUrl) {
          await upsertPhotoRecord(config, Boolean(user), {
            ...existing,
            baseUrl: item.baseUrl,
            baseUrlExpiresAt: item.baseUrlExpiresAt,
            thumbDataUrl: item.thumbDataUrl || existing.thumbDataUrl,
          });
        }
      }

      // Replace sample roll with real picked Google Photos (while keeping any unswiped real items)
      setCandidates((prev) => {
        const realPrev = prev.filter((p) => !p.id.startsWith('sample_'));
        const map = new Map(realPrev.map((p) => [p.id, p]));
        for (const p of picked) map.set(p.id, p);
        return Array.from(map.values());
      });
    } catch (err) {
      setToastError(err instanceof Error ? err.message : String(err));
    } finally {
      setPickerLoadingText('');
    }
  };

  const handleSwipe = async (photo: CandidatePhoto, status: PhotoStatus) => {
    const previousRecord = records[photo.id] || null;
    const actor = user?.email || 'local-device';

    const newRecord: PhotoRecord = {
      id: photo.id,
      filename: photo.filename,
      mimeType: photo.mimeType,
      createTime: photo.createTime,
      width: photo.width,
      height: photo.height,
      status,
      previousStatus: previousRecord?.status || null,
      thumbDataUrl: photo.thumbDataUrl,
      baseUrl: photo.baseUrl,
      baseUrlExpiresAt: photo.baseUrlExpiresAt,
      updatedAt: Date.now(),
      updatedBy: actor,
    };

    // Optimistically update local state immediately so the card deck advances in 0ms
    setRecords((prev) => ({ ...prev, [photo.id]: newRecord }));
    setUndoStack((prev) => [
      ...prev,
      {
        photo,
        previousRecord,
        appliedStatus: status,
      },
    ]);

    try {
      await upsertPhotoRecord(config, isAuthenticated, newRecord);
    } catch (err) {
      setToastError(err instanceof Error ? err.message : 'Could not save to Firestore');
    }
  };

  const handleUndo = async () => {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));

    // Optimistic state restore
    setRecords((prev) => {
      const next = { ...prev };
      if (last.previousRecord) {
        next[last.photo.id] = last.previousRecord;
      } else {
        delete next[last.photo.id];
      }
      return next;
    });

    setCandidates((prev) => [
      last.photo,
      ...prev.filter((item) => item.id !== last.photo.id),
    ]);

    try {
      if (last.previousRecord) {
        await upsertPhotoRecord(config, isAuthenticated, last.previousRecord);
      } else {
        await removePhotoRecord(config, isAuthenticated, last.photo.id);
      }
    } catch (err) {
      setToastError(err instanceof Error ? err.message : 'Undo sync failed');
    }
  };

  const handleUnmarkFromAdmin = async (ids: string[]) => {
    const restoredCandidates: CandidatePhoto[] = [];
    for (const id of ids) {
      const rec = records[id];
      if (rec) {
        restoredCandidates.push({
          id: rec.id,
          filename: rec.filename,
          mimeType: rec.mimeType,
          createTime: rec.createTime,
          width: rec.width,
          height: rec.height,
          thumbDataUrl: rec.thumbDataUrl,
          displayUrl: rec.thumbDataUrl,
          baseUrl: rec.baseUrl,
          baseUrlExpiresAt: rec.baseUrlExpiresAt,
        });
      }
    }

    setRecords((prev) => {
      const next = { ...prev };
      for (const id of ids) delete next[id];
      return next;
    });

    if (restoredCandidates.length > 0) {
      setCandidates((prev) => {
        const existingIds = new Set(prev.map((p) => p.id));
        const toAdd = restoredCandidates.filter((c) => !existingIds.has(c.id));
        return [...toAdd, ...prev];
      });
    }

    await bulkRemovePhotoRecords(config, isAuthenticated, ids);
  };

  const handleUpdateStatusFromAdmin = async (ids: string[], newStatus: PhotoStatus) => {
    const actor = user?.email || 'family-admin';
    const now = Date.now();
    setRecords((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        if (next[id]) {
          next[id] = { ...next[id], status: newStatus, updatedAt: now, updatedBy: actor };
        }
      }
      return next;
    });
    await bulkUpdatePhotoStatus(config, isAuthenticated, ids, newStatus, actor);
  };

  const handleSaveConfig = (newCfg: RuntimeConfig, manualToken?: string) => {
    saveRuntimeConfig(newCfg);
    setConfig(newCfg);
    if (manualToken !== undefined) {
      setAccessToken(manualToken);
      if (manualToken) storeAccessToken(manualToken);
    }
    setShowConfigModal(false);
  };

  return (
    <div className={`app-shell ${mode === 'swipe' ? 'is-swipe-mode' : ''}`}>
      {/* Sleek Minimal Top Bar */}
      <header className="top-header">
        <div className="brand-lockup">
          <div className="brand-icon">
            <Camera size={18} />
          </div>
          <span className="brand-name">PrintPick</span>
        </div>

        {/* Desktop Mode Switcher (Hidden on Mobile) */}
        <nav className="desktop-mode-pills" aria-label="Desktop Mode Switcher">
          <button
            type="button"
            className={`mode-pill-btn ${mode === 'swipe' ? 'active' : ''}`}
            onClick={() => switchMode('swipe')}
          >
            <Layers size={15} />
            <span>Swipe</span>
            <span className="count-chip">{unseenQueue.length}</span>
          </button>

          <button
            type="button"
            className={`mode-pill-btn ${mode === 'admin' ? 'active' : ''}`}
            onClick={() => switchMode('admin')}
          >
            <LayoutGrid size={15} />
            <span>Review &amp; Print</span>
            <span className="count-chip">{counts.print}</span>
          </button>
        </nav>

        {/* Clean Primary CTA + Account Avatar */}
        <div className="header-right-actions">
          <button
            id="btn-pick-google-photos"
            type="button"
            className="pill-btn pill-btn-ink"
            onClick={handleOpenGooglePicker}
          >
            <Plus size={15} strokeWidth={2.5} />
            <span>Google Photos</span>
          </button>

          <button
            id="btn-open-account"
            type="button"
            className="avatar-btn"
            onClick={() => setShowConfigModal(true)}
            aria-label="Account and Settings"
          >
            {user?.photoURL ? (
              <img src={user.photoURL} alt={user.displayName || 'Account'} referrerPolicy="no-referrer" />
            ) : (
              <UserIcon size={18} />
            )}
            {isAuthenticated && <span className="status-dot-online" />}
          </button>
        </div>
      </header>

      {toastError && (
        <div
          style={{
            margin: '8px 14px 0',
            padding: '10px 14px',
            borderRadius: '14px',
            background: 'var(--color-delete-soft)',
            border: '1px solid rgba(225, 29, 72, 0.25)',
            color: 'var(--color-delete)',
            fontSize: '12px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            flexShrink: 0,
          }}
        >
          <span>{toastError}</span>
          <button
            type="button"
            onClick={() => setToastError('')}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'inherit',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Content View */}
      {mode === 'swipe' ? (
        <SwipeView
          queue={unseenQueue}
          canUndo={undoStack.length > 0}
          onSwipe={handleSwipe}
          onUndo={handleUndo}
          onOpenGooglePicker={handleOpenGooglePicker}
          onReloadDemo={() => loadDemoRoll(true)}
          onJumpToAdmin={(tab) => switchMode('admin', tab)}
          counts={counts}
          pickerLoadingText={pickerLoadingText}
        />
      ) : (
        <AdminView
          records={records}
          accessToken={accessToken}
          initialTab={adminInitialTab}
          onUnmark={handleUnmarkFromAdmin}
          onUpdateStatus={handleUpdateStatusFromAdmin}
          onRefreshExpiredViaPicker={handleOpenGooglePicker}
        />
      )}

      {/* Mobile Bottom Tab Dock (< 768px) */}
      <nav className="mobile-bottom-nav" aria-label="Mobile Navigation">
        <button
          type="button"
          className={`mobile-nav-btn ${mode === 'swipe' ? 'active' : ''}`}
          onClick={() => switchMode('swipe')}
        >
          <Layers size={17} />
          <span>Swipe ({unseenQueue.length})</span>
        </button>

        <button
          type="button"
          className={`mobile-nav-btn ${mode === 'admin' ? 'active' : ''}`}
          onClick={() => switchMode('admin')}
        >
          <LayoutGrid size={17} />
          <span>Review &amp; Print ({counts.print})</span>
        </button>
      </nav>

      {showConfigModal && (
        <ConfigModal
          config={config}
          user={user}
          accessToken={accessToken}
          onSignIn={handleGoogleSignIn}
          onSignOut={() => signOutUser(config)}
          onSaveConfig={handleSaveConfig}
          onClose={() => setShowConfigModal(false)}
        />
      )}
    </div>
  );
};
