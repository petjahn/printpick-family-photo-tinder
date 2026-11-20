import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  deleteField,
  onSnapshot,
  writeBatch,
  Firestore,
} from 'firebase/firestore';
import { PhotoRecord, PhotoStatus, RuntimeConfig } from '../types';
import { isFirebaseConfigured } from './config';

const LOCAL_MIRROR_KEY = 'printpick_v2_firestore_mirror';
const TOKEN_STORAGE_KEY = 'printpick_v2_google_access_token';

let firebaseApp: FirebaseApp | null = null;
let firestoreDb: Firestore | null = null;
let localListeners: Array<(records: Record<string, PhotoRecord>) => void> = [];

export function initFirebaseIfConfigured(cfg: RuntimeConfig): {
  app: FirebaseApp | null;
  db: Firestore | null;
} {
  if (!isFirebaseConfigured(cfg)) {
    return { app: null, db: null };
  }
  try {
    const existing = getApps();
    firebaseApp =
      existing.length > 0
        ? existing[0]
        : initializeApp({
            apiKey: cfg.firebaseApiKey,
            authDomain: cfg.firebaseAuthDomain || `${cfg.firebaseProjectId}.firebaseapp.com`,
            projectId: cfg.firebaseProjectId,
            appId: cfg.firebaseAppId || undefined,
          });
    firestoreDb = getFirestore(firebaseApp);
    return { app: firebaseApp, db: firestoreDb };
  } catch (err) {
    console.error('Firebase initialization error:', err);
    return { app: null, db: null };
  }
}

export function getStoredAccessToken(): string {
  try {
    const raw = sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return '';
    const parsed = JSON.parse(raw) as { token: string; expiresAt: number };
    if (Date.now() > parsed.expiresAt) {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      return '';
    }
    return parsed.token;
  } catch {
    return '';
  }
}

export function storeAccessToken(token: string, expiresInSec = 3500): void {
  try {
    sessionStorage.setItem(
      TOKEN_STORAGE_KEY,
      JSON.stringify({
        token,
        expiresAt: Date.now() + expiresInSec * 1000,
      })
    );
  } catch {
    // ignore
  }
}

export async function signInWithGoogleAndPhotosScope(cfg: RuntimeConfig): Promise<{
  user: User;
  accessToken: string;
}> {
  const { app } = initFirebaseIfConfigured(cfg);
  if (!app) {
    throw new Error('Please configure your Firebase project keys in Settings first.');
  }
  const auth = getAuth(app);
  const provider = new GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/photospicker.mediaitems.readonly');
  provider.setCustomParameters({ prompt: 'select_account' });

  const result = await signInWithPopup(auth, provider);
  const email = (result.user.email || '').toLowerCase();

  if (
    cfg.allowedEmails.length > 0 &&
    !cfg.allowedEmails.map((e) => e.toLowerCase()).includes(email)
  ) {
    await fbSignOut(auth);
    throw new Error(
      `Account ${email} is not on the family allowlist (${cfg.allowedEmails.join(', ')}).`
    );
  }

  const credential = GoogleAuthProvider.credentialFromResult(result);
  const accessToken = credential?.accessToken || '';
  if (accessToken) {
    storeAccessToken(accessToken);
  }

  return { user: result.user, accessToken };
}

export async function signOutUser(cfg: RuntimeConfig): Promise<void> {
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  const { app } = initFirebaseIfConfigured(cfg);
  if (app) {
    await fbSignOut(getAuth(app));
  }
}

export function subscribeAuthState(
  cfg: RuntimeConfig,
  cb: (user: User | null) => void
): () => void {
  const { app } = initFirebaseIfConfigured(cfg);
  if (!app) {
    cb(null);
    return () => {};
  }
  const auth = getAuth(app);
  return onAuthStateChanged(auth, cb);
}

// Local mirror helpers (used before signing in or when testing Sample Roll)
function loadLocalMirror(): Record<string, PhotoRecord> {
  try {
    const raw = localStorage.getItem(LOCAL_MIRROR_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return {};
}

function saveLocalMirror(records: Record<string, PhotoRecord>): void {
  try {
    localStorage.setItem(LOCAL_MIRROR_KEY, JSON.stringify(records));
  } catch {
    // ignore
  }
  localListeners.forEach((fn) => fn({ ...records }));
}

export function subscribeFamilyPhotos(
  cfg: RuntimeConfig,
  isAuthenticated: boolean,
  onUpdate: (records: Record<string, PhotoRecord>) => void,
  onError?: (err: Error) => void
): () => void {
  const { db } = initFirebaseIfConfigured(cfg);
  if (!db || !isAuthenticated) {
    onUpdate(loadLocalMirror());
    localListeners.push(onUpdate);
    return () => {
      localListeners = localListeners.filter((l) => l !== onUpdate);
    };
  }

  const colRef = collection(db, 'workspaces', 'family', 'photos');
  return onSnapshot(
    colRef,
    (snapshot) => {
      const map: Record<string, PhotoRecord> = {};
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as PhotoRecord;
        map[docSnap.id] = data;
      });
      onUpdate(map);
    },
    (err) => {
      onError?.(err);
    }
  );
}

function prepareFirestorePayload(record: PhotoRecord): Record<string, unknown> {
  const shouldFreeLargePreview =
    record.status === 'shown' || record.status === 'delete' || record.status === 'printed';

  const entries = Object.entries(record).filter(([, v]) => v !== undefined);
  const payload: Record<string, unknown> = Object.fromEntries(entries);

  if (shouldFreeLargePreview || record.previewDataUrl === null) {
    // Remove ~65KB previewDataUrl from Firestore once swiped to Skip/Delete/Printed,
    // retaining the compact ~8KB thumbDataUrl for Admin grids!
    payload.previewDataUrl = deleteField();
  }

  return payload;
}

export async function upsertPhotoRecord(
  cfg: RuntimeConfig,
  isAuthenticated: boolean,
  record: PhotoRecord
): Promise<void> {
  const { db } = initFirebaseIfConfigured(cfg);
  if (!db || !isAuthenticated) {
    const current = loadLocalMirror();
    const copy = { ...record };
    if (copy.status === 'shown' || copy.status === 'delete' || copy.status === 'printed') {
      delete copy.previewDataUrl;
    }
    current[record.id] = copy;
    saveLocalMirror(current);
    return;
  }

  const docRef = doc(db, 'workspaces', 'family', 'photos', record.id);
  await setDoc(docRef, prepareFirestorePayload(record), { merge: true });
}

/**
 * Saves newly picked photos to Firestore in safe chunks of 25 documents per batch
 * so large selections (e.g. 200-500 photos) never exceed Firestore's 10 MiB batch limit.
 */
export async function bulkUpsertPhotoRecords(
  cfg: RuntimeConfig,
  isAuthenticated: boolean,
  recordsList: PhotoRecord[],
  onProgress?: (savedCount: number, total: number) => void
): Promise<void> {
  if (recordsList.length === 0) return;
  const { db } = initFirebaseIfConfigured(cfg);

  if (!db || !isAuthenticated) {
    const current = loadLocalMirror();
    for (const rec of recordsList) {
      current[rec.id] = rec;
    }
    saveLocalMirror(current);
    onProgress?.(recordsList.length, recordsList.length);
    return;
  }

  const CHUNK_SIZE = 25;
  for (let start = 0; start < recordsList.length; start += CHUNK_SIZE) {
    const slice = recordsList.slice(start, start + CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const rec of slice) {
      const ref = doc(db, 'workspaces', 'family', 'photos', rec.id);
      batch.set(ref, prepareFirestorePayload(rec), { merge: true });
    }
    await batch.commit();
    onProgress?.(Math.min(recordsList.length, start + slice.length), recordsList.length);
  }
}

export async function removePhotoRecord(
  cfg: RuntimeConfig,
  isAuthenticated: boolean,
  photoId: string
): Promise<void> {
  const { db } = initFirebaseIfConfigured(cfg);
  if (!db || !isAuthenticated) {
    const current = loadLocalMirror();
    delete current[photoId];
    saveLocalMirror(current);
    return;
  }
  const docRef = doc(db, 'workspaces', 'family', 'photos', photoId);
  await deleteDoc(docRef);
}

export async function bulkRemovePhotoRecords(
  cfg: RuntimeConfig,
  isAuthenticated: boolean,
  photoIds: string[]
): Promise<void> {
  if (photoIds.length === 0) return;
  const { db } = initFirebaseIfConfigured(cfg);
  if (!db || !isAuthenticated) {
    const current = loadLocalMirror();
    for (const id of photoIds) {
      delete current[id];
    }
    saveLocalMirror(current);
    return;
  }
  const CHUNK_SIZE = 250;
  for (let i = 0; i < photoIds.length; i += CHUNK_SIZE) {
    const batch = writeBatch(db);
    for (const id of photoIds.slice(i, i + CHUNK_SIZE)) {
      batch.delete(doc(db, 'workspaces', 'family', 'photos', id));
    }
    await batch.commit();
  }
}

export async function bulkUpdatePhotoStatus(
  cfg: RuntimeConfig,
  isAuthenticated: boolean,
  photoIds: string[],
  status: PhotoStatus,
  updatedBy: string
): Promise<void> {
  if (photoIds.length === 0) return;
  const now = Date.now();
  const { db } = initFirebaseIfConfigured(cfg);
  if (!db || !isAuthenticated) {
    const current = loadLocalMirror();
    for (const id of photoIds) {
      if (current[id]) {
        current[id] = {
          ...current[id],
          previousStatus: current[id].status,
          status,
          updatedAt: now,
          updatedBy,
        };
      }
    }
    saveLocalMirror(current);
    return;
  }

  const shouldFreePreview = status === 'shown' || status === 'delete' || status === 'printed';
  const CHUNK_SIZE = 250;
  for (let i = 0; i < photoIds.length; i += CHUNK_SIZE) {
    const batch = writeBatch(db);
    for (const id of photoIds.slice(i, i + CHUNK_SIZE)) {
      const ref = doc(db, 'workspaces', 'family', 'photos', id);
      const updatePayload: Record<string, unknown> = {
        status,
        updatedAt: now,
        updatedBy,
      };
      if (shouldFreePreview) {
        updatePayload.previewDataUrl = deleteField();
      }
      batch.set(ref, updatePayload, { merge: true });
    }
    await batch.commit();
  }
}

export async function bulkSetFavoriteFlag(
  cfg: RuntimeConfig,
  isAuthenticated: boolean,
  photoIds: string[],
  isFavorite: boolean
): Promise<void> {
  if (photoIds.length === 0) return;
  const { db } = initFirebaseIfConfigured(cfg);
  if (!db || !isAuthenticated) {
    const current = loadLocalMirror();
    for (const id of photoIds) {
      if (current[id]) {
        current[id] = { ...current[id], isFavorite };
      }
    }
    saveLocalMirror(current);
    return;
  }

  const CHUNK_SIZE = 250;
  for (let i = 0; i < photoIds.length; i += CHUNK_SIZE) {
    const batch = writeBatch(db);
    for (const id of photoIds.slice(i, i + CHUNK_SIZE)) {
      const ref = doc(db, 'workspaces', 'family', 'photos', id);
      batch.set(ref, { isFavorite }, { merge: true });
    }
    await batch.commit();
  }
}

