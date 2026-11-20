import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import { Layers, LayoutGrid, Plus, User as UserIcon, Camera, LogIn, Star } from 'lucide-react';
import { CandidatePhoto, PhotoRecord, PhotoStatus, RuntimeConfig, UndoAction } from './types';
import { isFirebaseConfigured, loadRuntimeConfig, saveRuntimeConfig } from './services/config';
import {
  bulkRemovePhotoRecords,
  bulkSetFavoriteFlag,
  bulkUpdatePhotoStatus,
  bulkUpsertPhotoRecords,
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
import { getCachedFullResBlob } from './services/idbCache';
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
  const [authInitialized, setAuthInitialized] = useState(false);
  const [accessToken, setAccessToken] = useState<string>(() => getStoredAccessToken());
  const [records, setRecords] = useState<Record<string, PhotoRecord>>({});
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [pickerLoadingText, setPickerLoadingText] = useState('');
  const [activePickerUrl, setActivePickerUrl] = useState('');
  const [toastError, setToastError] = useState('');
  const [hydratedBlobVersion, setHydratedBlobVersion] = useState(0);

  const localBlobUrlsRef = useRef<Record<string, string>>({});

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
    const unsubAuth = subscribeAuthState(config, (u) => {
      setUser(u);
      setAuthInitialized(true);
    });
    return () => unsubAuth();
  }, [config]);

  const isAuthenticated = Boolean(user);

  // Subscribe to family photos in Cloud Firestore when signed in
  useEffect(() => {
    if (!authInitialized) return;
    if (!isAuthenticated) {
      setRecords({});
      return;
    }
    const unsubPhotos = subscribeFamilyPhotos(
      config,
      true,
      (map) => setRecords(map),
      (err) => setToastError(err.message)
    );
    return () => unsubPhotos();
  }, [config, isAuthenticated, authInitialized]);

  // Hydrate 1920px HD cached blobs from IndexedDB for top pending items on page reload
  useEffect(() => {
    let cancelled = false;
    const pendingTop = Object.values(records)
      .filter((r) => r.status === 'pending' && !localBlobUrlsRef.current[recId(r)])
      .slice(0, 6);

    if (pendingTop.length === 0) return;

    (async () => {
      let added = false;
      for (const rec of pendingTop) {
        const blob = await getCachedFullResBlob(rec.id);
        if (blob && !cancelled && !localBlobUrlsRef.current[rec.id]) {
          localBlobUrlsRef.current[rec.id] = URL.createObjectURL(blob);
          added = true;
        }
      }
      if (added && !cancelled) {
        setHydratedBlobVersion((v) => v + 1);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [records]);

  // Active Swipe queue: all synced Firestore records with status === 'pending'
  const unseenQueue = useMemo<CandidatePhoto[]>(() => {
    void hydratedBlobVersion;
    return Object.values(records)
      .filter((r) => r.status === 'pending')
      .sort(
        (a, b) =>
          (a.pickedOrder || a.updatedAt || 0) - (b.pickedOrder || b.updatedAt || 0) ||
          a.createTime.localeCompare(b.createTime)
      )
      .map((rec) => ({
        id: rec.id,
        filename: rec.filename,
        mimeType: rec.mimeType,
        createTime: rec.createTime,
        width: rec.width,
        height: rec.height,
        isFavorite: Boolean(rec.isFavorite),
        thumbDataUrl: rec.thumbDataUrl,
        previewDataUrl: rec.previewDataUrl || undefined,
        displayUrl:
          localBlobUrlsRef.current[rec.id] || rec.previewDataUrl || rec.thumbDataUrl,
        baseUrl: rec.baseUrl,
        baseUrlExpiresAt: rec.baseUrlExpiresAt,
        pickedOrder: rec.pickedOrder,
      }));
  }, [records, hydratedBlobVersion]);

  const counts = useMemo(() => {
    const list = Object.values(records);
    return {
      print: list.filter((r) => r.status === 'print').length,
      delete: list.filter((r) => r.status === 'delete').length,
      shown: list.filter((r) => r.status === 'shown' || r.status === 'printed').length,
      pending: list.filter((r) => r.status === 'pending').length,
      superlikes: list.filter((r) => Boolean(r.isFavorite) && r.status !== 'delete').length,
    };
  }, [records]);

  const handleGoogleSignIn = async (): Promise<string> => {
    setToastError('');
    if (!isFirebaseConfigured(config)) {
      setShowConfigModal(true);
      setToastError('Firebase Project ID and API Key are missing — check Settings.');
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

  const handleOpenGooglePicker = async (markAsFavoritesBatch = false) => {
    setToastError('');
    if (!isAuthenticated || !accessToken) {
      await handleGoogleSignIn();
      return;
    }

    const popupWin = window.open('about:blank', '_blank');
    const waitingHint = markAsFavoritesBatch
      ? 'Tip: Type "Favorites" in the Google Photos search bar, select your starred photos, and tap Done!'
      : 'Select your photos in the Google Photos tab and tap Done...';

    try {
      setPickerLoadingText(
        markAsFavoritesBatch
          ? 'Opening Google Photos to sync your Starred Favourites...'
          : 'Creating Google Photos Picker session...'
      );
      const session = await createPickerSession(accessToken);
      setActivePickerUrl(session.pickerUri);

      if (popupWin && !popupWin.closed) {
        popupWin.location.href = session.pickerUri;
      }

      await pollPickerSessionUntilReady(session.id, accessToken, waitingHint, (msg) =>
        setPickerLoadingText(msg)
      );

      const existingStatusById: Record<string, string> = {};
      for (const [id, rec] of Object.entries(records)) {
        existingStatusById[id] = rec.status;
      }

      const { newOrRefreshedCandidates, matchedExistingFavoriteIds } =
        await listPickedMediaItems(
          session.id,
          accessToken,
          existingStatusById,
          markAsFavoritesBatch,
          (msg) => setPickerLoadingText(msg)
        );

      // 1. Instantly stamp isFavorite = true on any already-queued/existing photos matched by ID!
      if (matchedExistingFavoriteIds.length > 0) {
        setRecords((prev) => {
          const next = { ...prev };
          for (const id of matchedExistingFavoriteIds) {
            if (next[id]) next[id] = { ...next[id], isFavorite: true };
          }
          return next;
        });
        await bulkSetFavoriteFlag(config, true, matchedExistingFavoriteIds, true);
      }

      if (newOrRefreshedCandidates.length === 0) {
        setPickerLoadingText('');
        setActivePickerUrl('');
        return;
      }

      const actor = user?.email || 'family-member';
      const now = Date.now();
      const recordsToSync: PhotoRecord[] = [];

      for (const item of newOrRefreshedCandidates) {
        if (item.displayUrl) {
          localBlobUrlsRef.current[item.id] = item.displayUrl;
        }
        const existing = records[item.id];
        if (existing && existing.status === 'print') {
          recordsToSync.push({
            ...existing,
            isFavorite: Boolean(existing.isFavorite || item.isFavorite),
            baseUrl: item.baseUrl,
            baseUrlExpiresAt: item.baseUrlExpiresAt,
            previewDataUrl: item.previewDataUrl || existing.previewDataUrl || null,
            thumbDataUrl: item.thumbDataUrl || existing.thumbDataUrl,
            updatedAt: now,
          });
        } else if (!existing || existing.status === 'pending') {
          recordsToSync.push({
            id: item.id,
            filename: item.filename,
            mimeType: item.mimeType,
            createTime: item.createTime,
            width: item.width,
            height: item.height,
            status: 'pending',
            previousStatus: null,
            isFavorite: Boolean(existing?.isFavorite || item.isFavorite),
            thumbDataUrl: item.thumbDataUrl,
            previewDataUrl: item.previewDataUrl || null,
            baseUrl: item.baseUrl,
            baseUrlExpiresAt: item.baseUrlExpiresAt,
            pickedOrder: item.pickedOrder || now,
            updatedAt: now,
            updatedBy: actor,
          });
        }
      }

      setRecords((prev) => {
        const next = { ...prev };
        for (const r of recordsToSync) next[r.id] = r;
        return next;
      });

      await bulkUpsertPhotoRecords(config, true, recordsToSync, (savedCount, total) => {
        setPickerLoadingText(`Syncing queue to cloud (${savedCount}/${total})...`);
      });
    } catch (err) {
      if (popupWin && !popupWin.closed) {
        popupWin.close();
      }
      setToastError(err instanceof Error ? err.message : String(err));
    } finally {
      setPickerLoadingText('');
      setActivePickerUrl('');
    }
  };

  const handleSwipe = async (
    photo: CandidatePhoto,
    status: PhotoStatus,
    markAsSuperlike?: boolean
  ) => {
    const previousRecord = records[photo.id] || null;
    const actor = user?.email || 'family-member';
    const keepPreview = status === 'print' || status === 'pending';

    const newRecord: PhotoRecord = {
      id: photo.id,
      filename: photo.filename,
      mimeType: photo.mimeType,
      createTime: photo.createTime,
      width: photo.width,
      height: photo.height,
      status,
      previousStatus: previousRecord?.status || null,
      isFavorite: Boolean(markAsSuperlike || photo.isFavorite || previousRecord?.isFavorite),
      thumbDataUrl: photo.thumbDataUrl,
      previewDataUrl: keepPreview
        ? photo.previewDataUrl || previousRecord?.previewDataUrl || null
        : null,
      baseUrl: photo.baseUrl,
      baseUrlExpiresAt: photo.baseUrlExpiresAt,
      pickedOrder: photo.pickedOrder || previousRecord?.pickedOrder,
      updatedAt: Date.now(),
      updatedBy: actor,
    };

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
      setToastError(err instanceof Error ? err.message : 'Could not sync swipe to Firestore');
    }
  };

  const handleUndo = async () => {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));

    const restoredRecord: PhotoRecord | null = last.previousRecord
      ? {
          ...last.previousRecord,
          previewDataUrl:
            last.photo.previewDataUrl || last.previousRecord.previewDataUrl || null,
        }
      : null;

    setRecords((prev) => {
      const next = { ...prev };
      if (restoredRecord) {
        next[last.photo.id] = restoredRecord;
      } else {
        delete next[last.photo.id];
      }
      return next;
    });

    try {
      if (restoredRecord) {
        await upsertPhotoRecord(config, isAuthenticated, restoredRecord);
      } else {
        await removePhotoRecord(config, isAuthenticated, last.photo.id);
      }
    } catch (err) {
      setToastError(err instanceof Error ? err.message : 'Undo sync failed');
    }
  };

  const handleUnmarkFromAdmin = async (ids: string[]) => {
    const actor = user?.email || 'family-admin';
    const now = Date.now();

    setRecords((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        if (next[id]) {
          next[id] = {
            ...next[id],
            status: 'pending',
            pickedOrder: now,
            updatedAt: now,
            updatedBy: actor,
          };
        }
      }
      return next;
    });

    await bulkUpdatePhotoStatus(config, isAuthenticated, ids, 'pending', actor);
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

  const handleToggleFavoriteFromAdmin = async (id: string, nextFav: boolean) => {
    setRecords((prev) => {
      if (!prev[id]) return prev;
      return {
        ...prev,
        [id]: { ...prev[id], isFavorite: nextFav },
      };
    });
    await bulkSetFavoriteFlag(config, isAuthenticated, [id], nextFav);
  };

  const handleClearPendingQueue = async () => {
    const pendingIds = Object.values(records)
      .filter((r) => r.status === 'pending')
      .map((r) => r.id);
    if (pendingIds.length === 0) return;

    setRecords((prev) => {
      const next = { ...prev };
      for (const id of pendingIds) delete next[id];
      return next;
    });
    await bulkRemovePhotoRecords(config, isAuthenticated, pendingIds);
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

        {/* Explicit Sign-In vs Google Photos + Favourites CTAs + Account Avatar */}
        <div className="header-right-actions">
          {!isAuthenticated ? (
            <button
              id="btn-google-signin"
              type="button"
              className="pill-btn pill-btn-ink"
              onClick={handleGoogleSignIn}
            >
              <LogIn size={15} />
              <span>Sign In</span>
            </button>
          ) : (
            <>
              <button
                id="btn-pick-favorites"
                type="button"
                className="pill-btn pill-btn-super"
                onClick={() => handleOpenGooglePicker(true)}
                title="Sync Starred / Favourite photos from Google Photos as Super Likes"
              >
                <Star size={14} fill="currentColor" />
                <span className="hide-xs">Favourites</span>
              </button>

              <button
                id="btn-pick-google-photos"
                type="button"
                className="pill-btn pill-btn-ink"
                onClick={() => handleOpenGooglePicker(false)}
              >
                <Plus size={15} strokeWidth={2.5} />
                <span>Photos</span>
              </button>
            </>
          )}

          <button
            id="btn-open-account"
            type="button"
            className="avatar-btn"
            onClick={() => setShowConfigModal(true)}
            aria-label="Account and Settings"
          >
            {user?.photoURL ? (
              <img
                src={user.photoURL}
                alt={user.displayName || 'Account'}
                referrerPolicy="no-referrer"
              />
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
            position: 'fixed',
            top: 'calc(64px + env(safe-area-inset-top, 0px))',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 80,
            width: 'calc(100% - 28px)',
            maxWidth: '480px',
            padding: '12px 16px',
            borderRadius: '14px',
            background: '#fff1f2',
            border: '1px solid rgba(225, 29, 72, 0.35)',
            boxShadow: '0 12px 30px rgba(0, 0, 0, 0.16)',
            color: 'var(--color-delete)',
            fontSize: '12px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
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
          onSignIn={handleGoogleSignIn}
          onOpenGooglePicker={() => handleOpenGooglePicker(false)}
          onOpenFavoritesPicker={() => handleOpenGooglePicker(true)}
          onJumpToAdmin={(tab) => switchMode('admin', tab)}
          counts={counts}
          pickerLoadingText={pickerLoadingText}
          activePickerUrl={activePickerUrl}
          isCloudSynced={isAuthenticated}
        />
      ) : (
        <AdminView
          records={records}
          accessToken={accessToken}
          initialTab={adminInitialTab}
          onUnmark={handleUnmarkFromAdmin}
          onUpdateStatus={handleUpdateStatusFromAdmin}
          onToggleFavorite={handleToggleFavoriteFromAdmin}
          onRefreshExpiredViaPicker={() => handleOpenGooglePicker(false)}
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
          pendingCount={counts.pending}
          onSignIn={handleGoogleSignIn}
          onSignOut={() => signOutUser(config)}
          onClearPendingQueue={handleClearPendingQueue}
          onSaveConfig={handleSaveConfig}
          onClose={() => setShowConfigModal(false)}
        />
      )}
    </div>
  );
};

function recId(r: PhotoRecord): string {
  return r.id;
}
