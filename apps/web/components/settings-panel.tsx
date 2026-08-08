"use client";

import {
  ArrowLeft,
  Check,
  Cloud,
  LoaderCircle,
  LockKeyhole,
  Mail,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";

import type { PublicAccount } from "@/lib/mail/types";
import { authClient } from "@/lib/auth-client";

type AppConfig = {
  providers: { google: boolean; microsoft: boolean };
  integrations: {
    composio: boolean;
    google: boolean;
    microsoft: boolean;
  };
  appUrl: string;
};

export function SettingsPanel() {
  const params = useSearchParams();
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [passwordExpanded, setPasswordExpanded] = useState(true);
  const [migrationPasscode, setMigrationPasscode] = useState("");
  const [unownedAccounts, setUnownedAccounts] = useState(0);
  const [accounts, setAccounts] = useState<PublicAccount[]>([]);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(params.get("error") || "");

  const load = useCallback(async () => {
    const [sessionResponse, configResponse] = await Promise.all([
      fetch("/api/session"),
      fetch("/api/config"),
    ]);
    const session = await sessionResponse.json();
    setAuthenticated(Boolean(session.authenticated));
    setUser(session.user || null);
    if (configResponse.ok) {
      setConfig(await configResponse.json());
    }
    if (!session.authenticated) return;
    const [accountResponse, claimResponse] = await Promise.all([
      fetch("/api/accounts"),
      fetch("/api/bootstrap/claim"),
    ]);
    if (!accountResponse.ok) return;
    const accountPayload = await accountResponse.json();
    setAccounts(accountPayload.accounts);
    if (claimResponse.ok) {
      const claimPayload = await claimResponse.json();
      setUnownedAccounts(Number(claimPayload.unownedAccounts || 0));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function authenticate(event: FormEvent) {
    event.preventDefault();
    setBusy("password");
    setError("");
    const normalizedEmail = email.trim().toLowerCase();
    const result =
      authMode === "signup"
        ? await authClient.signUp.email({
            email: normalizedEmail,
            password,
            name: normalizedEmail.split("@")[0] || "Rubidium user",
          })
        : await authClient.signIn.email({
            email: normalizedEmail,
            password,
          });
    if (result.error) {
      setBusy(null);
      setError(
        result.error.message ||
          (authMode === "signup"
            ? "Account creation failed."
            : "Authentication failed."),
      );
      return;
    }
    setBusy(null);
    await load();
  }

  async function socialSignIn(provider: "google" | "microsoft") {
    setBusy(provider);
    setError("");
    const result = await authClient.signIn.social({
      provider,
      callbackURL: `/api/auth/provider-complete/${provider}`,
      errorCallbackURL: "/settings",
    });
    if (result.error) {
      setBusy(null);
      setError(result.error.message || `${provider} sign-in failed.`);
    }
  }

  async function claimExistingMail(event: FormEvent) {
    event.preventDefault();
    setBusy("claim");
    setError("");
    const response = await fetch("/api/bootstrap/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode: migrationPasscode }),
    });
    setBusy(null);
    if (!response.ok) {
      const payload = await response.json();
      setError(payload.error || "Could not migrate existing mail.");
      return;
    }
    setMigrationPasscode("");
    await load();
  }

  async function signOut() {
    setBusy("signout");
    await authClient.signOut();
    setBusy(null);
    setAccounts([]);
    setConfig(null);
    setUser(null);
    setAuthenticated(false);
  }

  async function sync(accountId?: string) {
    setBusy(accountId || "all");
    setError("");
    const response = await fetch("/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId, pages: 3 }),
    });
    setBusy(null);
    if (!response.ok) {
      const payload = await response.json();
      setError(payload.error || "Sync failed.");
      return;
    }
    await load();
  }

  async function remove(account: PublicAccount) {
    if (!window.confirm(`Disconnect ${account.email}? Local synced mail will be removed.`)) {
      return;
    }
    setBusy(account.id);
    const response = await fetch(`/api/accounts/${account.id}`, {
      method: "DELETE",
    });
    setBusy(null);
    if (!response.ok) {
      const payload = await response.json();
      setError(payload.error || "Could not disconnect this mailbox.");
      return;
    }
    await load();
  }

  if (authenticated === null) {
    return (
      <main className="settings-stage">
        <LoaderCircle className="settings-spinner spin" aria-label="Loading" />
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="settings-stage auth-stage">
        <section className="auth-shell">
          <aside className="auth-brand" aria-label="Rubidium">
            <header>
              <span className="settings-logo">rb</span>
              <span>
                <strong>Rubidium</strong>
                <small>Unified mail</small>
              </span>
            </header>
            <div className="auth-brand-copy">
              <p>One identity · every inbox</p>
              <h2>All your conversations. None of the switching.</h2>
              <p>
                A private workspace for Gmail and Outlook, designed to feel as
                direct as messaging.
              </p>
            </div>
            <div className="auth-assurances" aria-label="Account benefits">
              <span>
                <ShieldCheck size={16} />
                Private by default
              </span>
              <span>
                <Mail size={16} />
                Gmail + Outlook
              </span>
              <span>
                <Cloud size={16} />
                One live workspace
              </span>
            </div>
          </aside>

          <section className="unlock-card">
            <div className="auth-intro">
              <p className="settings-eyebrow">Your email is your account</p>
              <h1>Enter Rubidium</h1>
              <p>
                Sign in with the inbox you already use. Rubidium creates your
                private workspace and connects it in the same flow.
              </p>
            </div>

            <div className="auth-provider-stack" aria-label="Sign in options">
              <button
                type="button"
                className="auth-provider-button google"
                disabled={
                  Boolean(busy) || config?.providers.google === false
                }
                onClick={() => void socialSignIn("google")}
              >
                <span className="auth-provider-mark">G</span>
                <span>
                  <strong>Continue with Google</strong>
                  <small>Sign in, then connect Gmail</small>
                </span>
                {busy === "google" ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <span className="auth-provider-arrow">→</span>
                )}
              </button>
              <button
                type="button"
                className="auth-provider-button microsoft"
                disabled={
                  Boolean(busy) || config?.providers.microsoft === false
                }
                onClick={() => void socialSignIn("microsoft")}
              >
                <span className="auth-provider-mark">
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                <span>
                  <strong>Continue with Microsoft</strong>
                  <small>Sign in, then connect Outlook</small>
                </span>
                {busy === "microsoft" ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <span className="auth-provider-arrow">→</span>
                )}
              </button>
            </div>

            {config &&
            !config.providers.google &&
            !config.providers.microsoft ? (
              <div className="settings-error" role="alert">
                Social sign-in is not configured on this deployment.
              </div>
            ) : null}

            {error ? (
              <div className="settings-error" role="alert">
                {error}
              </div>
            ) : null}

            <details
              className="auth-password-fallback"
              open={passwordExpanded}
              onToggle={(event) => setPasswordExpanded(event.currentTarget.open)}
            >
              <summary>
                {authMode === "signup"
                  ? "Create a Rubidium account"
                  : "Use email and password"}
              </summary>
              <div className="auth-mode-switch" aria-label="Password account mode">
                <button
                  type="button"
                  className={authMode === "signin" ? "active" : ""}
                  onClick={() => setAuthMode("signin")}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  className={authMode === "signup" ? "active" : ""}
                  onClick={() => setAuthMode("signup")}
                >
                  Create account
                </button>
              </div>
              <form onSubmit={authenticate}>
                <div className="auth-fields">
                  <label>
                    Email
                    <span>
                      <Mail size={17} />
                      <input
                        type="email"
                        autoComplete="email"
                        placeholder="you@example.com"
                        required
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                      />
                    </span>
                  </label>
                  <label>
                    Password
                    <span>
                      <LockKeyhole size={17} />
                      <input
                        type="password"
                        autoComplete={
                          authMode === "signup"
                            ? "new-password"
                            : "current-password"
                        }
                        minLength={8}
                        placeholder={
                          authMode === "signup"
                            ? "Choose a secure password"
                            : "Your password"
                        }
                        required
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                      />
                    </span>
                  </label>
                </div>
                <button
                  className="settings-primary"
                  disabled={busy === "password"}
                >
                  {busy === "password" ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : null}
                  {authMode === "signup" ? "Create account" : "Sign in with password"}
                </button>
              </form>
            </details>

            <small className="auth-note">
              Sign in once, then connect Gmail or Outlook securely through
              Composio. Additional inboxes join the same Rubidium workspace.
            </small>
          </section>
        </section>
      </main>
    );
  }

  const connected = params.get("connected");

  return (
    <main className="settings-stage">
      <section className="settings-shell">
        <header className="settings-header">
          <Link href="/" className="settings-back">
            <ArrowLeft size={17} />
            Inbox
          </Link>
          <div>
            <p className="settings-eyebrow">rbmail control room</p>
            <h1>Accounts</h1>
            <p>{user?.email} · every mailbox, one conversation-first inbox.</p>
          </div>
          <div className="settings-header-actions">
            <button
              className="settings-sync-all"
              type="button"
              onClick={() => void sync()}
              disabled={Boolean(busy) || accounts.length === 0}
            >
              <RefreshCw className={busy === "all" ? "spin" : ""} size={16} />
              Sync all
            </button>
            <button
              className="settings-back"
              type="button"
              onClick={() => void signOut()}
              disabled={busy === "signout"}
            >
              Sign out
            </button>
          </div>
        </header>

        {connected ? (
          <div className="settings-success">
            <Check size={17} />
            {connected === "microsoft" ? "Outlook" : "Google"} is connected and syncing.
          </div>
        ) : null}
        {error ? <div className="settings-error">{error}</div> : null}
        {unownedAccounts > 0 ? (
          <form className="migration-card" onSubmit={claimExistingMail}>
            <div>
              <ShieldCheck size={20} />
              <span>
                <strong>Claim the existing owner workspace</strong>
                <small>
                  {unownedAccounts} pre-migration mailbox
                  {unownedAccounts === 1 ? "" : "es"} can be assigned to this user.
                </small>
              </span>
            </div>
            <input
              aria-label="Existing owner passcode"
              type="password"
              inputMode="numeric"
              required
              value={migrationPasscode}
              onChange={(event) => setMigrationPasscode(event.target.value)}
              placeholder="Existing passcode"
            />
            <button className="settings-primary" disabled={busy === "claim"}>
              Claim mail
            </button>
          </form>
        ) : null}

        <div className="settings-grid">
          <section className="settings-card">
            <span className="provider-icon google">G</span>
            <div>
              <h2>Google</h2>
              <p>Gmail accounts and Google Workspace.</p>
            </div>
            {config?.integrations.google ? (
              <a
                className="settings-primary"
                href={
                  config.integrations.composio
                    ? "/api/composio/connect/google"
                    : "/api/oauth/google/start"
                }
              >
                Connect
              </a>
            ) : (
              <span className="settings-unconfigured">Connection unavailable</span>
            )}
          </section>

          <section className="settings-card">
            <span className="provider-icon microsoft">M</span>
            <div>
              <h2>Microsoft</h2>
              <p>Outlook, Microsoft 365, work, and school.</p>
            </div>
            {config?.integrations.microsoft ? (
              <a
                className="settings-primary"
                href={
                  config.integrations.composio
                    ? "/api/composio/connect/microsoft"
                    : "/api/oauth/microsoft/start"
                }
              >
                Connect
              </a>
            ) : (
              <span className="settings-unconfigured">Connection unavailable</span>
            )}
          </section>
        </div>

        <section className="connected-section">
          <div className="section-title">
            <div>
              <h2>Connected mailboxes</h2>
              <p>Tokens and synced content are encrypted at rest.</p>
            </div>
            <ShieldCheck size={21} />
          </div>
          {accounts.length ? (
            <div className="connected-list">
              {accounts.map((account) => (
                <article key={account.id}>
                  <span className={`provider-icon ${account.provider}`}>
                    {account.provider === "google" ? "G" : "M"}
                  </span>
                  <div>
                    <strong>{account.displayName || account.email}</strong>
                    <span>{account.email}</span>
                    <small>
                      {account.lastSyncAt
                        ? `Synced ${new Date(account.lastSyncAt).toLocaleString()}`
                        : "Waiting for first sync"}
                    </small>
                    <small className="account-capability">
                      {account.authBackend === "composio"
                        ? "Managed securely by Composio"
                        : "Direct provider connection"}
                    </small>
                    {account.authBackend === "direct" &&
                    config?.integrations.composio ? (
                      <a
                        className="settings-reconnect"
                        href={`/api/composio/connect/${account.provider}`}
                      >
                        Move this mailbox to Composio
                      </a>
                    ) : null}
                    {account.capabilities.calendar ? (
                      <small className="account-capability">Mail + Calendar</small>
                    ) : (
                      <a
                        className="settings-reconnect"
                        href={
                          config?.integrations.composio
                            ? `/api/composio/connect/${account.provider}`
                            : `/api/oauth/${account.provider}/start`
                        }
                      >
                        Reconnect to enable Calendar
                      </a>
                    )}
                  </div>
                  <span className={`account-status ${account.status}`}>
                    {account.status.replace("_", " ")}
                  </span>
                  <button
                    className="settings-icon-button"
                    type="button"
                    title="Sync now"
                    disabled={Boolean(busy)}
                    onClick={() => void sync(account.id)}
                  >
                    <RefreshCw className={busy === account.id ? "spin" : ""} size={16} />
                  </button>
                  <button
                    className="settings-icon-button danger"
                    type="button"
                    title="Disconnect"
                    disabled={Boolean(busy)}
                    onClick={() => void remove(account)}
                  >
                    <Trash2 size={16} />
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="connected-empty">
              <Mail size={27} />
              <h3>No accounts yet</h3>
              <p>Connect Gmail or Outlook above. You can add as many as you like.</p>
            </div>
          )}
        </section>

        <footer className="settings-privacy">
          <Cloud size={16} />
          <span>
            Private Rubidium workspaces · provider credentials managed by Composio · encrypted local content
          </span>
        </footer>
      </section>
    </main>
  );
}
