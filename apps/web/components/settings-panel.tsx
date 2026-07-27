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

type AppConfig = {
  providers: { google: boolean; microsoft: boolean };
  appUrl: string;
};

export function SettingsPanel() {
  const params = useSearchParams();
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [accounts, setAccounts] = useState<PublicAccount[]>([]);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(params.get("error") || "");

  const load = useCallback(async () => {
    const session = await fetch("/api/session").then((response) => response.json());
    setAuthenticated(Boolean(session.authenticated));
    if (!session.authenticated) return;
    const [accountResponse, configResponse] = await Promise.all([
      fetch("/api/accounts"),
      fetch("/api/config"),
    ]);
    if (!accountResponse.ok || !configResponse.ok) return;
    const accountPayload = await accountResponse.json();
    setAccounts(accountPayload.accounts);
    setConfig(await configResponse.json());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function unlock(event: FormEvent) {
    event.preventDefault();
    setBusy("unlock");
    setError("");
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(null);
    if (!response.ok) {
      const payload = await response.json();
      setError(payload.error || "Could not unlock rbmail.");
      return;
    }
    await load();
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
        <form className="unlock-card" onSubmit={unlock}>
          <span className="settings-logo">rb</span>
          <p className="settings-eyebrow">Private by default</p>
          <h1>Unlock your mail</h1>
          <p>Your owner password protects this self-hosted instance.</p>
          <label>
            Access password
            <span>
              <LockKeyhole size={17} />
              <input
                autoFocus
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </span>
          </label>
          {error ? <div className="settings-error">{error}</div> : null}
          <button className="settings-primary" disabled={busy === "unlock"}>
            {busy === "unlock" ? <LoaderCircle className="spin" size={17} /> : null}
            Unlock
          </button>
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
            <p>Every mailbox, one conversation-first inbox.</p>
          </div>
          <button
            className="settings-sync-all"
            type="button"
            onClick={() => void sync()}
            disabled={Boolean(busy) || accounts.length === 0}
          >
            <RefreshCw className={busy === "all" ? "spin" : ""} size={16} />
            Sync all
          </button>
        </header>

        {connected ? (
          <div className="settings-success">
            <Check size={17} />
            {connected === "microsoft" ? "Outlook" : "Google"} is connected and syncing.
          </div>
        ) : null}
        {error ? <div className="settings-error">{error}</div> : null}

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
            Self-hosted data plane · no advertising profile · no cross-account data leaves your instance
          </span>
        </footer>
      </section>
    </main>
  );
}
