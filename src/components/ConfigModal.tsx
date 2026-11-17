import React, { useState } from 'react';
import { X, Save, KeyRound } from 'lucide-react';
import { RuntimeConfig } from '../types';

interface ConfigModalProps {
  config: RuntimeConfig;
  accessToken: string;
  onSaveConfig: (newCfg: RuntimeConfig, manualAccessToken?: string) => void;
  onClose: () => void;
}

export const ConfigModal: React.FC<ConfigModalProps> = ({
  config,
  accessToken,
  onSaveConfig,
  onClose,
}) => {
  const [firebaseApiKey, setFirebaseApiKey] = useState(config.firebaseApiKey);
  const [firebaseAuthDomain, setFirebaseAuthDomain] = useState(config.firebaseAuthDomain);
  const [firebaseProjectId, setFirebaseProjectId] = useState(config.firebaseProjectId);
  const [firebaseAppId, setFirebaseAppId] = useState(config.firebaseAppId);
  const [googleClientId, setGoogleClientId] = useState(config.googleClientId);
  const [allowedEmailsText, setAllowedEmailsText] = useState(config.allowedEmails.join(', '));
  const [manualToken, setManualToken] = useState(accessToken);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const allowedEmails = allowedEmailsText
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    onSaveConfig(
      {
        firebaseApiKey: firebaseApiKey.trim(),
        firebaseAuthDomain: firebaseAuthDomain.trim(),
        firebaseProjectId: firebaseProjectId.trim(),
        firebaseAppId: firebaseAppId.trim(),
        googleClientId: googleClientId.trim(),
        allowedEmails,
      },
      manualToken.trim()
    );
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Firebase and Google Photos Configuration">
      <form className="modal-panel" onSubmit={handleSubmit}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid var(--border-subtle)',
            paddingBottom: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <KeyRound size={18} color="var(--accent-blue)" />
            <h2 style={{ fontSize: '15px', fontWeight: 600 }}>
              Firebase &amp; Google Photos Setup
            </h2>
          </div>
          <button type="button" className="btn" onClick={onClose} style={{ padding: '4px 8px' }}>
            <X size={15} />
          </button>
        </div>

        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Configure your Firebase project (for real-time shared Firestore sync across devices) and
          Google Sign-In with the <strong>Google Photos Picker API</strong> enabled. Values are
          saved locally in your browser or can be set via <code className="font-mono">VITE_*</code>{' '}
          GitHub Actions secrets.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div className="form-field">
            <label htmlFor="cfg-fb-api-key">Firebase API Key</label>
            <input
              id="cfg-fb-api-key"
              type="text"
              className="font-mono"
              placeholder="AIzaSy..."
              value={firebaseApiKey}
              onChange={(e) => setFirebaseApiKey(e.target.value)}
            />
          </div>

          <div className="form-field">
            <label htmlFor="cfg-fb-project-id">Firebase Project ID</label>
            <input
              id="cfg-fb-project-id"
              type="text"
              className="font-mono"
              placeholder="my-family-photos"
              value={firebaseProjectId}
              onChange={(e) => setFirebaseProjectId(e.target.value)}
            />
          </div>

          <div className="form-field">
            <label htmlFor="cfg-fb-auth-domain">Firebase Auth Domain (optional)</label>
            <input
              id="cfg-fb-auth-domain"
              type="text"
              className="font-mono"
              placeholder="my-family-photos.firebaseapp.com"
              value={firebaseAuthDomain}
              onChange={(e) => setFirebaseAuthDomain(e.target.value)}
            />
          </div>

          <div className="form-field">
            <label htmlFor="cfg-fb-app-id">Firebase App ID (optional)</label>
            <input
              id="cfg-fb-app-id"
              type="text"
              className="font-mono"
              placeholder="1:123456:web:abcdef"
              value={firebaseAppId}
              onChange={(e) => setFirebaseAppId(e.target.value)}
            />
          </div>
        </div>

        <div className="form-field">
          <label htmlFor="cfg-allowed-emails">
            Allowed Family Google Emails (comma-separated, shared database)
          </label>
          <input
            id="cfg-allowed-emails"
            type="text"
            className="font-mono"
            placeholder="parent1@gmail.com, parent2@gmail.com"
            value={allowedEmailsText}
            onChange={(e) => setAllowedEmailsText(e.target.value)}
          />
        </div>

        <div className="form-field">
          <label htmlFor="cfg-google-client-id">
            Google OAuth 2.0 Web Client ID (optional if using Firebase Google Auth popup)
          </label>
          <input
            id="cfg-google-client-id"
            type="text"
            className="font-mono"
            placeholder="123456789-abc.apps.googleusercontent.com"
            value={googleClientId}
            onChange={(e) => setGoogleClientId(e.target.value)}
          />
        </div>

        <div className="form-field">
          <label htmlFor="cfg-manual-token">
            Direct OAuth Access Token Override (optional, scope:{' '}
            <code className="font-mono">photospicker.mediaitems.readonly</code>)
          </label>
          <input
            id="cfg-manual-token"
            type="password"
            className="font-mono"
            placeholder="ya29.a0..."
            value={manualToken}
            onChange={(e) => setManualToken(e.target.value)}
          />
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '8px',
            borderTop: '1px solid var(--border-subtle)',
            paddingTop: '12px',
          }}
        >
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            <Save size={15} />
            <span>Save Configuration</span>
          </button>
        </div>
      </form>
    </div>
  );
};
