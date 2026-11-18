import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { User } from 'firebase/auth';
import {
  Smartphone,
  ShieldCheck,
  ImagePlus,
  Settings,
  LogIn,
  LogOut,
  Database,
} from 'lucide-react';
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
import { AdminView } from './components/AdminView';
import { ConfigModal } from './components/ConfigModal';

type AppMode = 'swipe' | 'admin';

export const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>(() =>
    window.location.hash === '#admin' ? 'admin' : 'swipe'
  );
  const [config, setConfig] = useState<RuntimeConfig>(() => loadRuntimeConfig());
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string>(() => getStoredAccessToken());
  const [records, setRecords] = useState<Record<string, PhotoRecord>>({});
  const [candidates, setCandidates] = useState<CandidatePhoto[]>([]);
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [pickerLoadingText, setPickerLoadingText] = useState('');
  const [authError, setAuthError] = useState('');

  // Keep URL hash in sync with active interface (#swipe vs #admin)
  const switchMode = (nextMode: AppMode) => {
    setMode(nextMode);
    window.location.hash = nextMode;
  };

  useEffect(() => {
    const onHashChange = () => {
      if (window.location.hash === '#admin') setMode('admin');
      else if (window.location.hash === '#swipe') setMode('swipe');
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Subscribe to Firebase Auth & Family Firestore collection
  useEffect(() => {
    const unsubAuth = subscribeAuthState(config, (u) => setUser(u));
    const unsubPhotos = subscribeFamilyPhotos(
      config,
      (map) => setRecords(map),
      (err) => setAuthError(err.message)
    );
    return () => {
      unsubAuth();
      unsubPhotos();
    };
  }, [config]);

  // Seed initial sample candidates so the swipe deck works immediately before picking
  const loadDemoRoll = useCallback(async () => {
    const demoItems = await generateDemoCandidates();
    setCandidates(demoItems);
  }, []);

  useEffect(() => {
    loadDemoRoll();
  }, [loadDemoRoll]);

  // Filter out any candidate photo that already has a status in Firestore (print, delete, shown, printed)
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
    setAuthError('');
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
      setAuthError(msg);
      return '';
    }
  };

  const handleOpenGooglePicker = async () => {
    setAuthError('');
    let token = accessToken;
    if (!token) {
      token = await handleGoogleSignIn();
    }
    if (!token) {
      setShowConfigModal(true);
      return;
    }

    try {
      setPickerLoadingText('Creating Google Photos Picker session...');
      const session = await createPickerSession(token);
      window.open(session.pickerUri, '_blank', 'width=980,height=740');

      await pollPickerSessionUntilReady(session.id, token, (msg) => setPickerLoadingText(msg));
      setPickerLoadingText('Downloading selected photo metadata & generating compact thumbnails...');
      const picked = await listPickedMediaItems(session.id, token, (msg) =>
        setPickerLoadingText(msg)
      );

      // If any picked item already exists in Firestore (e.g. refreshing an expired Print link in Admin),
      // update its fresh 60-minute baseUrl in Firestore!
      for (const item of picked) {
        const existing = records[item.id];
        if (existing && item.baseUrl) {
          await upsertPhotoRecord(config, {
            ...existing,
            baseUrl: item.baseUrl,
            baseUrlExpiresAt: item.baseUrlExpiresAt,
            thumbDataUrl: item.thumbDataUrl || existing.thumbDataUrl,
          });
        }
      }

      // Add newly picked items to candidate deck (already-processed ones are filtered out by unseenQueue)
      setCandidates((prev) => {
        const map = new Map(prev.map((p) => [p.id, p]));
        for (const p of picked) map.set(p.id, p);
        return Array.from(map.values());
      });
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err));
    } finally {
      setPickerLoadingText('');
    }
  };

  const handleSwipe = async (photo: CandidatePhoto, status: PhotoStatus) => {
    const previousRecord = records[photo.id] || null;
    const actor = user?.email || 'family-member';

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

    setUndoStack((prev) => [
      ...prev,
      {
        photo,
        previousRecord,
        appliedStatus: status,
      },
    ]);

    await upsertPhotoRecord(config, newRecord);
  };

  const handleUndo = async () => {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));

    if (last.previousRecord) {
      await upsertPhotoRecord(config, last.previousRecord);
    } else {
      await removePhotoRecord(config, last.photo.id);
    }

    // Ensure the candidate photo is at the front of the candidate list
    setCandidates((prev) => [
      last.photo,
      ...prev.filter((item) => item.id !== last.photo.id),
    ]);
  };

  const handleUnmarkFromAdmin = async (ids: string[]) => {
    // Capture records before removing so if the user switches back to Swipe on the same session,
    // they can also re-swipe them if desired
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

    await bulkRemovePhotoRecords(config, ids);

    if (restoredCandidates.length > 0) {
      setCandidates((prev) => {
        const existingIds = new Set(prev.map((p) => p.id));
        const toAdd = restoredCandidates.filter((c) => !existingIds.has(c.id));
        return [...toAdd, ...prev];
      });
    }
  };

  const handleUpdateStatusFromAdmin = async (ids: string[], newStatus: PhotoStatus) => {
    const actor = user?.email || 'family-admin';
    await bulkUpdatePhotoStatus(config, ids, newStatus, actor);
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

  const fbConnected = isFirebaseConfigured(config);

  return (
    <div className="app-shell">
      {/* Top Bar */}
      <header className="top-nav">
        <div className="brand-group">
          <div className="brand-mark">PP</div>
          <div>
            <div className="brand-title">PrintPick</div>
            <div className="brand-subtitle">
              {fbConnected ? `Firestore: ${config.firebaseProjectId}` : 'Demo Mode (Local Mirror)'}
              {' • '}
              <a
                href="./privacy.html"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--text-secondary)', textDecoration: 'underline' }}
              >
                Privacy
              </a>
            </div>
          </div>
        </div>

        {/* Distinct Interface Switcher: Swipe vs Admin */}
        <nav className="mode-switcher" aria-label="Interface Mode">
          <button
            id="nav-mode-swipe"
            type="button"
            className={`mode-tab ${mode === 'swipe' ? 'active' : ''}`}
            onClick={() => switchMode('swipe')}
          >
            <Smartphone size={15} />
            <span>Swipe</span>
            <span className="mode-badge">{unseenQueue.length}</span>
          </button>

          <button
            id="nav-mode-admin"
            type="button"
            className={`mode-tab ${mode === 'admin' ? 'active' : ''}`}
            onClick={() => switchMode('admin')}
          >
            <ShieldCheck size={15} />
            <span>Admin</span>
            <span className="mode-badge">{counts.print}</span>
          </button>
        </nav>

        {/* Google Photos + Auth + Settings Controls */}
        <div className="nav-actions">
          <button
            id="btn-pick-google-photos"
            type="button"
            className="btn btn-primary"
            onClick={handleOpenGooglePicker}
            title="Select photos from Google Photos"
          >
            <ImagePlus size={15} />
            <span className="hide-mobile">Google Photos</span>
          </button>

          {user ? (
            <button
              type="button"
              className="btn"
              onClick={() => signOutUser(config)}
              title={`Signed in as ${user.email} — Click to sign out`}
            >
              <LogOut size={15} />
              <span className="hide-mobile">{user.email?.split('@')[0]}</span>
            </button>
          ) : (
            <button
              id="btn-google-signin"
              type="button"
              className="btn"
              onClick={handleGoogleSignIn}
              title="Sign in with Google"
            >
              <LogIn size={15} />
              <span className="hide-mobile">Sign In</span>
            </button>
          )}

          <button
            id="btn-open-settings"
            type="button"
            className="btn"
            onClick={() => setShowConfigModal(true)}
            title="Configure Firebase & Google Photos API credentials"
          >
            {fbConnected ? <Database size={15} color="var(--status-print)" /> : <Settings size={15} />}
          </button>
        </div>
      </header>

      {authError && (
        <div
          style={{
            background: 'var(--status-delete-bg)',
            borderBottom: '1px solid var(--status-delete)',
            color: 'var(--text-primary)',
            padding: '8px 16px',
            fontSize: '12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{authError}</span>
          <button
            type="button"
            className="btn"
            style={{ padding: '2px 8px', fontSize: '11px' }}
            onClick={() => setAuthError('')}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Render either Mobile-First Swipe Interface or Admin Interface */}
      {mode === 'swipe' ? (
        <SwipeView
          queue={unseenQueue}
          canUndo={undoStack.length > 0}
          onSwipe={handleSwipe}
          onUndo={handleUndo}
          onOpenGooglePicker={handleOpenGooglePicker}
          onReloadDemo={loadDemoRoll}
          counts={counts}
          pickerLoadingText={pickerLoadingText}
        />
      ) : (
        <AdminView
          records={records}
          accessToken={accessToken}
          onUnmark={handleUnmarkFromAdmin}
          onUpdateStatus={handleUpdateStatusFromAdmin}
          onRefreshExpiredViaPicker={handleOpenGooglePicker}
        />
      )}

      {showConfigModal && (
        <ConfigModal
          config={config}
          accessToken={accessToken}
          onSaveConfig={handleSaveConfig}
          onClose={() => setShowConfigModal(false)}
        />
      )}
    </div>
  );
};
