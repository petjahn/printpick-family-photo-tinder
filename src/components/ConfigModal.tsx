import React, { useState } from 'react';
import { User } from 'firebase/auth';
import { X, Save, LogIn, LogOut, ChevronDown, ChevronUp, ShieldCheck } from 'lucide-react';
import { RuntimeConfig } from '../types';
import { isFirebaseConfigured } from '../services/config';

interface ConfigModalProps {
  config: RuntimeConfig;
  user: User | null;
  accessToken: string;
  onSignIn: () => Promise<string>;
  onSignOut: () => Promise<void>;
  onSaveConfig: (newCfg: RuntimeConfig, manualAccessToken?: string) => void;
  onClose: () => void;
}

export const ConfigModal: React.FC<ConfigModalProps> = ({
  config,
  user,
  accessToken,
  onSignIn,
  onSignOut,
  onSaveConfig,
  onClose,
}) => {
  const fbReady = isFirebaseConfigured(config);
  const [showAdvanced, setShowAdvanced] = useState(!fbReady);

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
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Account and Connection Settings"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form className="sheet-panel" onSubmit={handleSubmit}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 800, letterSpacing: '-0.02em' }}>
            Family Account &amp; Sync
          </h2>
          <button
            type="button"
            className="pill-btn"
            style={{ padding: '6px 10px' }}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        {/* Account Card */}
        <div
          style={{
            background: 'var(--bg-canvas)',
            borderRadius: 'var(--radius-md)',
            padding: '14px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          {user ? (
            <>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '14px', fontWeight: 700 }}>{user.displayName || 'Signed In'}</div>
                <div
                  style={{
                    fontSize: '12px',
                    color: 'var(--ink-secondary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {user.email}
                </div>
                <div
                  style={{
                    fontSize: '11px',
                    color: 'var(--color-print)',
                    fontWeight: 600,
                    marginTop: '3px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <ShieldCheck size={13} />
                  <span>Connected to Firestore ({config.firebaseProjectId})</span>
                </div>
              </div>
              <button
                type="button"
                className="pill-btn"
                onClick={async () => {
                  await onSignOut();
                  onClose();
                }}
              >
                <LogOut size={14} />
                <span>Sign Out</span>
              </button>
            </>
          ) : (
            <>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 700 }}>Sign in with Google</div>
                <div style={{ fontSize: '12px', color: 'var(--ink-secondary)', marginTop: '2px' }}>
                  Sync print picks across devices &amp; pick from Google Photos
                </div>
              </div>
              <button
                type="button"
                className="pill-btn pill-btn-ink"
                onClick={async () => {
                  const tok = await onSignIn();
                  if (tok) onClose();
                }}
              >
                <LogIn size={14} />
                <span>Sign In</span>
              </button>
            </>
          )}
        </div>

        {/* Collapsible Advanced Firebase Configuration */}
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          style={{
            background: 'transparent',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '13px',
            fontWeight: 700,
            color: 'var(--ink-secondary)',
            cursor: 'pointer',
            padding: '4px 0',
          }}
        >
          <span>Firebase &amp; Allowlist Settings</span>
          {showAdvanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>

        {showAdvanced && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div className="field-group">
                <label htmlFor="cfg-fb-project-id">Firebase Project ID</label>
                <input
                  id="cfg-fb-project-id"
                  type="text"
                  placeholder="family-photo-tinder"
                  value={firebaseProjectId}
                  onChange={(e) => setFirebaseProjectId(e.target.value)}
                />
              </div>

              <div className="field-group">
                <label htmlFor="cfg-fb-api-key">Firebase API Key</label>
                <input
                  id="cfg-fb-api-key"
                  type="text"
                  placeholder="AIzaSy..."
                  value={firebaseApiKey}
                  onChange={(e) => setFirebaseApiKey(e.target.value)}
                />
              </div>
            </div>

            <div className="field-group">
              <label htmlFor="cfg-allowed-emails">Allowed Family Emails (comma-separated)</label>
              <input
                id="cfg-allowed-emails"
                type="text"
                placeholder="you@gmail.com, partner@gmail.com"
                value={allowedEmailsText}
                onChange={(e) => setAllowedEmailsText(e.target.value)}
              />
            </div>

            <div className="field-group">
              <label htmlFor="cfg-manual-token">Manual OAuth Token Override (optional)</label>
              <input
                id="cfg-manual-token"
                type="password"
                placeholder="ya29.a0..."
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
              />
            </div>

            <button type="submit" className="pill-btn pill-btn-ink" style={{ width: '100%', padding: '11px' }}>
              <Save size={15} />
              <span>Save Settings</span>
            </button>
          </div>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '12px',
            color: 'var(--ink-muted)',
            borderTop: '1px solid var(--border-hairline)',
            paddingTop: '12px',
          }}
        >
          <a href="./privacy.html" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>
            Privacy Policy
          </a>
          <a href="./terms.html" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>
            Terms of Service
          </a>
        </div>
      </form>
    </div>
  );
};
