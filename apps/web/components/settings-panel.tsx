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
  appUrl: string;
};

export function SettingsPanel() {
  const params = useSearchParams();
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [migrationPasscode, setMigrationPasscode] = useState("");
  const [unownedAccounts, setUnownedAccounts] = useState(0);
  const [accounts, setAccounts] = useState<PublicAccount[]>([]);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(params.get("error") || "");

  const load = useCallback(async () => {
    const session = await fetch("/api/session").then((response) => response.json());
    setAuthenticated(Boolean(session.authenticated));
    setUser(session.user || null);
    if (!session.authenticated) return;
    const [accountResponse, configResponse, claimResponse] = await Promise.all([
      fetch("/api/accounts"),
      fetch("/api/config"),
      fetch("/api/bootstrap/claim"),
    ]);
    if (!accountResponse.ok || !configResponse.ok) return;
    const accountPayload = await accountResponse.json();
    setAccounts(accountPayload.accounts);
    setConfig(await configResponse.json());
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
    setBusy("auth");
    setError("");
    const result =
      authMode === "signup"
        ? await authClient.signUp.email({
            name: name.trim(),
            email: email.trim(),
            password,
          })
        : await authClient.signIn.email({
            email: email.trim(),
            password,
          });
    if (result.error) {
      setBusy(null);
      setError(result.error.message || "Authentication failed.");
      return;
    }
    if (authMode === "signup" && migrationPasscode) {
      const claimResponse = await fetch("/api/bootstrap/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passcode: migrationPasscode }),
      });
      if (!claimResponse.ok) {
        const payload = await claimResponse.json();
        setError(
          payload.error ||
            "Your account was created, but existing mail was not migrated.",
        );
      }
    }
    setBusy(null);
    await load();
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
    await fetch(`/api/accounts/${account.id}`, { method: "DELETE" });
    setBusy(null);
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
      <main className="settings-stage">
        <form className="unlock-card" onSubmit={authenticate}>
          <span className="settings-logo">rb</span>
          <p className="settings-eyebrow">One identity · every inbox</p>
          <h1>{authMode === "signup" ? "Create your account" : "Welcome back"}</h1>
          <p>
            {authMode === "signup"
              ? "Your Rubidium account keeps your mailboxes private from every other user."
              : "Sign in to your private mail workspace."}
          </p>
          <div className="auth-switch" role="tablist" aria-label="Authentication">
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
          {authMode === "signup" ? (
            <label>
              Name
              <span>
                <input
                  autoFocus
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </span>
            </label>
          ) : null}
          <label>
            Email
            <span>
              <Mail size={17} />
              <input
                autoFocus={authMode === "signin"}
                type="email"
                autoComplete="email"
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
                  authMode === "signup" ? "new-password" : "current-password"
                }
                minLength={8}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </span>
          </label>
          {authMode === "signup" ? (
            <label>
              Existing-owner passcode <small>optional</small>
              <span>
                <ShieldCheck size={17} />
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={migrationPasscode}
                  onChange={(event) => setMigrationPasscode(event.target.value)}
                  placeholder="Only needed to claim existing mail"
                />
              </span>
            </label>
          ) : null}
          {error ? <div className="settings-error">{error}</div> : null}
          <button className="settings-primary" disabled={busy === "auth"}>
            {busy === "auth" ? <LoaderCircle className="spin" size={17} /> : null}
            {authMode === "signup" ? "Create private workspace" : "Sign in"}
          </button>
          <small className="auth-note">
            New users start with an empty workspace, then connect their own Gmail
            or Outlook accounts.
          </small>
        </form>
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
            {config?.providers.google ? (
              <a className="settings-primary" href="/api/oauth/google/start">
                Connect
              </a>
            ) : (
              <span className="settings-unconfigured">OAuth keys needed</span>
            )}
          </section>

          <section className="settings-card">
            <span className="provider-icon microsoft">M</span>
            <div>
              <h2>Microsoft</h2>
              <p>Outlook, Microsoft 365, work, and school.</p>
            </div>
            {config?.providers.microsoft ? (
              <a className="settings-primary" href="/api/oauth/microsoft/start">
                Connect
              </a>
            ) : (
              <span className="settings-unconfigured">OAuth keys needed</span>
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
                    {account.capabilities.calendar ? (
                      <small className="account-capability">Mail + Calendar</small>
                    ) : (
                      <a
                        className="settings-reconnect"
                        href={`/api/oauth/${account.provider}/start`}
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
            Self-hosted data plane · private user workspaces · encrypted provider tokens and content
          </span>
        </footer>
      </section>
    </main>
  );
}
