import { RuntimeConfig } from '../types';

const CONFIG_STORAGE_KEY = 'printpick_v2_runtime_config';

export function loadRuntimeConfig(): RuntimeConfig {
  let saved: Partial<RuntimeConfig> = {};
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (raw) saved = JSON.parse(raw);
  } catch {
    // ignore storage errors
  }

  const envAllowed = (import.meta.env.VITE_ALLOWED_EMAILS || '')
    .split(',')
    .map((s: string) => s.trim().toLowerCase())
    .filter(Boolean);

  return {
    firebaseApiKey: saved.firebaseApiKey || import.meta.env.VITE_FIREBASE_API_KEY || '',
    firebaseAuthDomain: saved.firebaseAuthDomain || import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
    firebaseProjectId: saved.firebaseProjectId || import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
    firebaseAppId: saved.firebaseAppId || import.meta.env.VITE_FIREBASE_APP_ID || '',
    googleClientId: saved.googleClientId || import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
    allowedEmails:
      saved.allowedEmails && saved.allowedEmails.length > 0 ? saved.allowedEmails : envAllowed,
  };
}

export function saveRuntimeConfig(cfg: RuntimeConfig): void {
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(cfg));
}

export function isFirebaseConfigured(cfg: RuntimeConfig): boolean {
  return Boolean(cfg.firebaseApiKey && cfg.firebaseProjectId);
}
