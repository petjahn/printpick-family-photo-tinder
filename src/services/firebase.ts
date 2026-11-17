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
  provider.setCustomParameters({ prompt: 'consent' });

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

// Local mirror helpers (used when testing in Demo Mode before Firebase keys are configured)
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
  onUpdate: (records: Record<string, PhotoRecord>) => void,
  onError?: (err: Error) => void
): () => void {
  const { db } = initFirebaseIfConfigured(cfg);
  if (!db) {
    // Demo / local mirror mode
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

export async function upsertPhotoRecord(
  cfg: RuntimeConfig,
  record: PhotoRecord
): Promise<void> {
  const { db } = initFirebaseIfConfigured(cfg);
  if (!db) {
    const current = loadLocalMirror();
    current[record.id] = record;
    saveLocalMirror(current);
    return;
  }
  const docRef = doc(db, 'workspaces', 'family', 'photos', record.id);
  await setDoc(docRef, record, { merge: true });
}

export async function removePhotoRecord(
  cfg: RuntimeConfig,
  photoId: string
): Promise<void> {
  const { db } = initFirebaseIfConfigured(cfg);
  if (!db) {
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
  photoIds: string[]
): Promise<void> {
  if (photoIds.length === 0) return;
  const { db } = initFirebaseIfConfigured(cfg);
  if (!db) {
    const current = loadLocalMirror();
    for (const id of photoIds) {
      delete current[id];
    }
    saveLocalMirror(current);
    return;
  }
  const batch = writeBatch(db);
  for (const id of photoIds) {
    batch.delete(doc(db, 'workspaces', 'family', 'photos', id));
  }
  await batch.commit();
}

export async function bulkUpdatePhotoStatus(
  cfg: RuntimeConfig,
  photoIds: string[],
  status: PhotoStatus,
  updatedBy: string
): Promise<void> {
  if (photoIds.length === 0) return;
  const now = Date.now();
  const { db } = initFirebaseIfConfigured(cfg);
  if (!db) {
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
  const batch = writeBatch(db);
  for (const id of photoIds) {
    const ref = doc(db, 'workspaces', 'family', 'photos', id);
    batch.set(ref, { status, updatedAt: now, updatedBy }, { merge: true });
  }
  await batch.commit();
}
