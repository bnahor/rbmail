"use client";

import {
  Archive,
  ArrowLeft,
  AtSign,
  Bell,
  Bookmark,
  Check,
  ChevronDown,
  Clock3,
  Command,
  FileText,
  Inbox,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  PenLine,
  Plane,
  Plus,
  Receipt,
  Reply,
  Search,
  Send,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  accounts,
  initialThreads,
  type AccountId,
  type MailThread,
} from "@/lib/mock-mail";
import type {
  PublicAccount,
  ThreadDetail,
  ThreadSummary,
} from "@/lib/mail/types";

type AccountFilter = "all" | string;
type ViewId = "inbox" | "reply" | "receipts" | "travel" | "later";

type UiAccount = {
  id: string;
  slot: AccountId;
  label: string;
  email: string;
  color: string;
  unread: number;
};

const avatarTones = ["#d9f2cc", "#d7e4ff", "#f5d7ec", "#ffe2b6", "#e7ddff"];

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "?";
}

function displayTime(value: string) {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { weekday: "short" });
}

function inferTag(thread: ThreadSummary) {
  const text = `${thread.subject} ${thread.snippet} ${thread.labels.join(" ")}`.toLowerCase();
  if (/invoice|receipt|payment|bank|paid/.test(text)) return "Finance";
  if (/flight|hotel|booking|travel|trip/.test(text)) return "Travel";
  if (/newsletter|digest|weekly|issue/.test(text)) return "Read later";
  return thread.unread ? "Needs reply" : undefined;
}

function mapSummary(
  thread: ThreadSummary,
  accountIndex: Map<string, number>,
): MailThread {
  const index = accountIndex.get(thread.accountId) ?? 0;
  const slot: AccountId = index % 2 === 0 ? "personal" : "studio";
  const sender =
    thread.participants.find(
      (participant) => participant.address.toLowerCase() !== thread.email.toLowerCase(),
    ) ?? thread.participants[0];
  const senderName = sender?.name || sender?.address || "Unknown sender";
  return {
    id: thread.id,
    sender: senderName,
    initials: initials(senderName),
    subject: thread.subject,
    preview: thread.snippet,
    time: displayTime(thread.lastMessageAt),
    sortTime: new Date(thread.lastMessageAt).getTime(),
    account: slot,
    remoteAccountId: thread.accountId,
    sourceEmail: thread.email,
    provider: thread.provider,
    unread: thread.unread,
    tag: inferTag(thread),
    avatarTone: avatarTones[index % avatarTones.length],
    messages: [],
  };
}

function mapDetail(thread: ThreadDetail): MailThread["messages"] {
  return thread.messages.map((message) => {
    const outgoing =
      message.from.address.toLowerCase() === thread.email.toLowerCase();
    return {
      id: message.id,
      author: outgoing ? "You" : message.from.name || message.from.address,
      email: message.from.address,
      time: new Date(message.receivedAt).toLocaleString([], {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      }),
      body: message.bodyText || message.snippet,
      outgoing,
    };
  });
}

const views: Array<{
  id: ViewId;
  label: string;
  icon: typeof Inbox;
  count?: number;
}> = [
  { id: "inbox", label: "Everything", icon: Inbox, count: 7 },
  { id: "reply", label: "Needs reply", icon: MessageCircle, count: 2 },
  { id: "receipts", label: "Money", icon: Receipt },
  { id: "travel", label: "Travel", icon: Plane },
  { id: "later", label: "Read later", icon: Bookmark },
];

function IconButton({
  label,
  children,
  className = "",
  onClick,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <button
      className={`icon-button ${className}`}
      aria-label={label}
      title={label}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function MailShell() {
  const [threads, setThreads] = useState(initialThreads);
  const [selectedId, setSelectedId] = useState(initialThreads[0].id);
  const [accountFilter, setAccountFilter] = useState<AccountFilter>("all");
  const [activeView, setActiveView] = useState<ViewId>("inbox");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [semanticMatches, setSemanticMatches] = useState<string[] | null>(null);
  const [semanticStatus, setSemanticStatus] = useState<
    "idle" | "loading" | "ready" | "fallback"
  >("idle");
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reply, setReply] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [mailError, setMailError] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [compose, setCompose] = useState({
    accountId: "",
    to: "",
    subject: "",
    body: "",
  });
  const [composeBusy, setComposeBusy] = useState(false);
  const [composeError, setComposeError] = useState("");
  const [realMailbox, setRealMailbox] = useState(false);
  const [connectedAccounts, setConnectedAccounts] = useState<UiAccount[]>(
    Object.values(accounts).map((account) => ({
      id: account.id,
      slot: account.id,
      label: account.label,
      email: account.email,
      color: account.color,
      unread: account.unread,
    })),
  );
  const [swipe, setSwipe] = useState<{ id: string; x: number } | null>(null);
  const pointerStart = useRef<{ id: string; x: number } | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const replyInput = useRef<HTMLTextAreaElement>(null);
  const semanticWorker = useRef<Worker | null>(null);
  const indexedSignature = useRef("");

  useEffect(() => {
    let cancelled = false;
    async function loadMailbox() {
      const session = await fetch("/api/session").then((response) => response.json());
      if (!session.authenticated) {
        window.location.assign("/settings");
        return;
      }
      const [accountResponse, threadResponse] = await Promise.all([
        fetch("/api/accounts"),
        fetch("/api/threads?limit=150"),
      ]);
      if (!accountResponse.ok || !threadResponse.ok || cancelled) return;
      const accountPayload = (await accountResponse.json()) as {
        accounts: PublicAccount[];
      };
      const threadPayload = (await threadResponse.json()) as {
        threads: ThreadSummary[];
      };
      const index = new Map(
        accountPayload.accounts.map((account, position) => [account.id, position]),
      );
      const nextThreads = threadPayload.threads.map((thread) =>
        mapSummary(thread, index),
      );
      const nextAccounts = accountPayload.accounts.map((account, position) => {
        const slot: AccountId = position % 2 === 0 ? "personal" : "studio";
        return {
          id: account.id,
          slot,
          label: account.displayName || (account.provider === "google" ? "Google" : "Outlook"),
          email: account.email,
          color: accounts[slot].color,
          unread: nextThreads.filter(
            (thread) => thread.remoteAccountId === account.id && thread.unread,
          ).length,
        };
      });
      setRealMailbox(true);
      setConnectedAccounts(nextAccounts);
      setThreads(nextThreads);
      setSelectedId(nextThreads[0]?.id || "");
      if (nextThreads[0]) await hydrateThread(nextThreads[0].id);
    }
    async function hydrateThread(id: string) {
      const response = await fetch(`/api/threads/${encodeURIComponent(id)}`);
      if (!response.ok || cancelled) return;
      const payload = (await response.json()) as { thread: ThreadDetail };
      setThreads((current) =>
        current.map((thread) =>
          thread.id === id ? { ...thread, messages: mapDetail(payload.thread) } : thread,
        ),
      );
    }
    void loadMailbox();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredThreads = useMemo(() => {
    return threads
      .filter(
        (thread) =>
          accountFilter === "all" ||
          (thread.remoteAccountId ?? thread.account) === accountFilter,
      )
      .filter((thread) => {
        if (activeView === "reply") return thread.tag === "Needs reply";
        if (activeView === "receipts")
          return thread.tag === "Finance" || thread.tag === "Receipt";
        if (activeView === "travel") return thread.tag === "Travel";
        if (activeView === "later") return thread.tag === "Read later";
        return true;
      });
  }, [accountFilter, activeView, threads]);

  const selected =
    threads.find((thread) => thread.id === selectedId) ?? filteredThreads[0];

  const semanticResults = useMemo(() => {
    if (!searchQuery.trim()) return threads.slice(0, 4);
    if (semanticMatches?.length) {
      const byId = new Map(threads.map((thread) => [thread.id, thread]));
      return semanticMatches
        .map((id) => byId.get(id))
        .filter((thread): thread is MailThread => Boolean(thread));
    }
    const terms = searchQuery.toLowerCase();
    const direct = threads.filter((thread) =>
      `${thread.sender} ${thread.subject} ${thread.preview} ${thread.tag ?? ""}`
        .toLowerCase()
        .includes(terms),
    );
    if (direct.length) return direct;
    if (/invoice|payment|paid|money|amount/.test(terms)) {
      return threads.filter((thread) =>
        ["invoice", "bank"].includes(thread.id),
      );
    }
    if (/trip|flight|tokyo|travel/.test(terms)) {
      return threads.filter((thread) => thread.id === "flight");
    }
    if (/reply|respond|waiting/.test(terms)) {
      return threads.filter((thread) => thread.tag === "Needs reply");
    }
    return threads.slice(0, 3);
  }, [searchQuery, semanticMatches, threads]);

  useEffect(() => {
    return () => {
      semanticWorker.current?.terminate();
      semanticWorker.current = null;
    };
  }, []);

  useEffect(() => {
    if (!searchOpen || !searchQuery.trim() || semanticWorker.current) return;
    const worker = new Worker(
      new URL("../workers/semantic-worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (
      event: MessageEvent<{
        type: "status" | "indexed" | "results";
        status?: "idle" | "loading" | "ready" | "fallback";
        ids?: string[];
      }>,
    ) => {
      if (event.data.type === "status" && event.data.status) {
        setSemanticStatus(event.data.status);
      }
      if (event.data.type === "indexed") setSemanticStatus("ready");
      if (event.data.type === "results") setSemanticMatches(event.data.ids ?? []);
    };
    semanticWorker.current = worker;
    indexedSignature.current = threads
      .map((thread) => `${thread.id}:${thread.subject}:${thread.preview}`)
      .join("|");
    worker.postMessage({
      type: "index",
      documents: threads.map((thread) => ({
        id: thread.id,
        text: [
          thread.sender,
          thread.subject,
          thread.preview,
          thread.tag,
          ...thread.messages.map((message) => message.body.slice(0, 800)),
        ]
          .filter(Boolean)
          .join("\n"),
      })),
    });
  }, [searchOpen, searchQuery, threads]);

  useEffect(() => {
    const signature = threads
      .map((thread) => `${thread.id}:${thread.subject}:${thread.preview}`)
      .join("|");
    if (!semanticWorker.current || signature === indexedSignature.current) return;
    indexedSignature.current = signature;
    semanticWorker.current.postMessage({
      type: "index",
      documents: threads.map((thread) => ({
        id: thread.id,
        text: [
          thread.sender,
          thread.subject,
          thread.preview,
          thread.tag,
          ...thread.messages.map((message) => message.body.slice(0, 800)),
        ]
          .filter(Boolean)
          .join("\n"),
      })),
    });
  }, [threads]);

  useEffect(() => {
    setSemanticMatches(null);
    if (!searchQuery.trim() || !semanticWorker.current) return;
    const timer = window.setTimeout(() => {
      semanticWorker.current?.postMessage({
        type: "query",
        query: searchQuery,
      });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isTyping =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (event.key === "/" && !isTyping) {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key.toLowerCase() === "c" && !isTyping) {
        event.preventDefault();
        openComposer();
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setMenuOpen(false);
      }
      if (isTyping || searchOpen) return;
      const index = filteredThreads.findIndex((thread) => thread.id === selectedId);
      if (event.key === "j") {
        const next = filteredThreads[Math.min(index + 1, filteredThreads.length - 1)];
        if (next) setSelectedId(next.id);
      }
      if (event.key === "k") {
        const next = filteredThreads[Math.max(index - 1, 0)];
        if (next) setSelectedId(next.id);
      }
      if (event.key === "e" && selected) archiveThread(selected.id);
      if (event.key === "r") {
        event.preventDefault();
        replyInput.current?.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    if (searchOpen) {
      window.setTimeout(() => searchInput.current?.focus(), 80);
    }
  }, [searchOpen]);

  async function chooseThread(id: string) {
    setSelectedId(id);
    setMobileThreadOpen(true);
    setThreads((current) =>
      current.map((thread) =>
        thread.id === id ? { ...thread, unread: false } : thread,
      ),
    );
    const thread = threads.find((candidate) => candidate.id === id);
    if (thread?.remoteAccountId && thread.messages.length === 0) {
      const response = await fetch(`/api/threads/${encodeURIComponent(id)}`);
      if (response.ok) {
        const payload = (await response.json()) as { thread: ThreadDetail };
        setThreads((current) =>
          current.map((candidate) =>
            candidate.id === id
              ? { ...candidate, messages: mapDetail(payload.thread) }
              : candidate,
          ),
        );
      }
    }
  }

  function archiveThread(id: string) {
    const thread = threads.find((candidate) => candidate.id === id);
    if (thread?.remoteAccountId) {
      void fetch(`/api/threads/${encodeURIComponent(id)}/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "archive" }),
      });
    }
    setThreads((current) => current.filter((thread) => thread.id !== id));
    const remaining = filteredThreads.filter((thread) => thread.id !== id);
    if (selectedId === id && remaining[0]) setSelectedId(remaining[0].id);
    setMobileThreadOpen(false);
  }

  function toggleRead(id: string) {
    const thread = threads.find((candidate) => candidate.id === id);
    const nextUnread = !thread?.unread;
    if (thread?.remoteAccountId) {
      void fetch(`/api/threads/${encodeURIComponent(id)}/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: nextUnread ? "unread" : "read" }),
      });
    }
    setThreads((current) =>
      current.map((thread) =>
        thread.id === id ? { ...thread, unread: !thread.unread } : thread,
      ),
    );
  }

  function onPointerDown(event: ReactPointerEvent, id: string) {
    pointerStart.current = { id, x: event.clientX };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent, id: string) {
    if (pointerStart.current?.id !== id) return;
    const x = Math.max(-116, Math.min(116, event.clientX - pointerStart.current.x));
    if (Math.abs(x) > 5) setSwipe({ id, x });
  }

  function onPointerUp(id: string) {
    if (swipe?.id === id && swipe.x < -82) archiveThread(id);
    if (swipe?.id === id && swipe.x > 82) toggleRead(id);
    setSwipe(null);
    pointerStart.current = null;
  }

  function openComposer() {
    if (realMailbox && connectedAccounts.length === 0) {
      window.location.assign("/settings");
      return;
    }
    setCompose((current) => ({
      ...current,
      accountId: current.accountId || connectedAccounts[0]?.id || "",
    }));
    setComposeError("");
    setComposeOpen(true);
  }

  async function sendNewMessage() {
    if (!compose.to.trim() || !compose.subject.trim() || !compose.body.trim()) return;
    if (!realMailbox) {
      setComposeOpen(false);
      setCompose({ accountId: "", to: "", subject: "", body: "" });
      return;
    }
    setComposeBusy(true);
    setComposeError("");
    const response = await fetch("/api/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(compose),
    });
    setComposeBusy(false);
    if (!response.ok) {
      const payload = await response.json();
      setComposeError(payload.error || "Could not send this message.");
      return;
    }
    setComposeOpen(false);
    setCompose({ accountId: "", to: "", subject: "", body: "" });
  }

  async function sendReply() {
    if (!reply.trim() || !selected) return;
    const text = reply.trim();
    setMailError("");
    if (selected.remoteAccountId) {
      setSending(true);
      const response = await fetch(
        `/api/threads/${encodeURIComponent(selected.id)}/reply`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: text }),
        },
      );
      setSending(false);
      if (!response.ok) {
        const payload = await response.json();
        setMailError(payload.error || "Could not send this reply.");
        return;
      }
    }
    setThreads((current) =>
      current.map((thread) =>
        thread.id === selected.id
          ? {
              ...thread,
              preview: text,
              messages: [
                ...thread.messages,
                {
                  id: `reply-${Date.now()}`,
                  author: "You",
                  email:
                    thread.sourceEmail || accounts[thread.account].email,
                  time: "Now",
                  body: text,
                  outgoing: true,
                },
              ],
            }
          : thread,
      ),
    );
    setReply("");
    setSent(true);
    window.setTimeout(() => setSent(false), 1800);
  }

  const unreadTotal = threads.filter((thread) => thread.unread).length;

  return (
    <main className="mail-stage">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <section
        className={`mail-app ${mobileThreadOpen ? "mobile-thread-open" : ""}`}
        aria-label="Unified mail application"
      >
        <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
          <div className="brand-row">
            <div className="brand-mark">rb</div>
            <div>
              <strong>mail</strong>
              <span>one quiet place</span>
            </div>
            <IconButton
              label="Close menu"
              className="mobile-only close-menu"
              onClick={() => setMenuOpen(false)}
            >
              <X size={18} />
            </IconButton>
          </div>

          <button className="compose-button" type="button" onClick={openComposer}>
            <PenLine size={17} strokeWidth={2.2} />
            <span>New message</span>
            <kbd>C</kbd>
          </button>

          <nav className="view-nav" aria-label="Mailbox views">
            <p className="nav-eyebrow">Your views</p>
            {views.map((view) => {
              const ViewIcon = view.icon;
              return (
                <button
                  className={activeView === view.id ? "active" : ""}
                  key={view.id}
                  type="button"
                  onClick={() => {
                    setActiveView(view.id);
                    setMenuOpen(false);
                  }}
                >
                  <ViewIcon size={17} />
                  <span>{view.label}</span>
                  {view.id === "inbox" ? (
                    <em>{unreadTotal}</em>
                  ) : view.count ? (
                    <em>{view.count}</em>
                  ) : null}
                </button>
              );
            })}
          </nav>

          <div className="account-section">
            <p className="nav-eyebrow">Accounts</p>
            {connectedAccounts.map(
              (account) => (
                <button
                  className={`account-row ${
                    accountFilter === account.id ? "active" : ""
                  }`}
                  type="button"
                  key={account.id}
                  onClick={() =>
                    setAccountFilter((current) =>
                      current === account.id ? "all" : account.id,
                    )
                  }
                >
                  <span
                    className="account-glyph"
                    style={{ "--account-color": account.color } as CSSProperties}
                  >
                    {account.label.slice(0, 1).toUpperCase()}
                  </span>
                  <span>
                    <strong>{account.label}</strong>
                    <small>{account.email}</small>
                  </span>
                  <em>{account.unread}</em>
                </button>
              ),
            )}
            <button
              className="add-account"
              type="button"
              onClick={() => window.location.assign("/settings")}
            >
              <Plus size={15} />
              Add account
            </button>
          </div>

          <div className="sidebar-footer">
            <button type="button" onClick={() => window.location.assign("/settings")}>
              <Settings2 size={16} />
              Settings
            </button>
            <div className="user-avatar">RB</div>
          </div>
        </aside>

        {menuOpen ? (
          <button
            className="menu-scrim mobile-only"
            type="button"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          />
        ) : null}

        <section className="inbox-panel">
          <header className="inbox-header">
            <div className="inbox-title-row">
              <IconButton
                className="mobile-only"
                label="Open menu"
                onClick={() => setMenuOpen(true)}
              >
                <Menu size={20} />
              </IconButton>
              <div>
                <span className="today-label">Monday, 27 July</span>
                <h1>
                  {views.find((view) => view.id === activeView)?.label ??
                    "Everything"}
                </h1>
              </div>
              <button className="all-account-pill" type="button">
                <span className="stacked-dots">
                  {(connectedAccounts.length
                    ? connectedAccounts.slice(0, 2)
                    : [
                        { color: accounts.personal.color },
                        { color: accounts.studio.color },
                      ]
                  ).map((account, index) => (
                    <i key={index} style={{ background: account.color }} />
                  ))}
                </span>
                {accountFilter === "all"
                  ? "All accounts"
                  : connectedAccounts.find((account) => account.id === accountFilter)
                      ?.label || "Account"}
                <ChevronDown size={14} />
              </button>
            </div>

            <button
              className="search-trigger"
              type="button"
              onClick={() => setSearchOpen(true)}
            >
              <Search size={17} />
              <span>Ask anything about your mail</span>
              <kbd>/</kbd>
            </button>
          </header>

          <div className="list-toolbar">
            <span>
              {filteredThreads.length} conversations
              {accountFilter !== "all"
                ? ` · ${
                    connectedAccounts.find((account) => account.id === accountFilter)
                      ?.label || "Account"
                  }`
                : ""}
            </span>
            <div>
              <IconButton label="Filter conversations">
                <SlidersHorizontal size={16} />
              </IconButton>
              <IconButton label="More list options">
                <MoreHorizontal size={17} />
              </IconButton>
            </div>
          </div>

          <div className="thread-list" role="list">
            {filteredThreads.length ? (
              filteredThreads.map((thread, index) => {
                const account = accounts[thread.account];
                const swipeX = swipe?.id === thread.id ? swipe.x : 0;
                return (
                  <div
                    className="thread-swipe-wrap"
                    key={thread.id}
                    style={{ "--row-delay": `${index * 34}ms` } as CSSProperties}
                  >
                    <div className="swipe-action swipe-read">
                      <Check size={18} />
                      {thread.unread ? "Read" : "Unread"}
                    </div>
                    <div className="swipe-action swipe-archive">
                      <Archive size={18} />
                      Archive
                    </div>
                    <button
                      className={`thread-row ${
                        selected?.id === thread.id ? "selected" : ""
                      } ${thread.unread ? "unread" : ""}`}
                      type="button"
                      role="listitem"
                      style={{ transform: `translateX(${swipeX}px)` }}
                      onClick={() => {
                        if (Math.abs(swipeX) < 8) void chooseThread(thread.id);
                      }}
                      onPointerDown={(event) => onPointerDown(event, thread.id)}
                      onPointerMove={(event) => onPointerMove(event, thread.id)}
                      onPointerUp={() => onPointerUp(thread.id)}
                      onPointerCancel={() => onPointerUp(thread.id)}
                    >
                      <span
                        className="avatar"
                        style={{ background: thread.avatarTone }}
                      >
                        {thread.initials}
                        <i style={{ background: account.color }} />
                      </span>
                      <span className="thread-copy">
                        <span className="thread-meta">
                          <strong>{thread.sender}</strong>
                          <time>{thread.time}</time>
                        </span>
                        <span className="thread-subject">{thread.subject}</span>
                        <span className="thread-preview">{thread.preview}</span>
                        <span className="thread-foot">
                          {thread.tag ? <em>{thread.tag}</em> : null}
                          <small>{account.label}</small>
                        </span>
                      </span>
                      {thread.unread ? <span className="unread-dot" /> : null}
                    </button>
                  </div>
                );
              })
            ) : (
              <div className="empty-view">
                <span>
                  <Check size={26} />
                </span>
                <h2>{realMailbox && connectedAccounts.length === 0 ? "Bring your mail" : "All quiet here"}</h2>
                <p>
                  {realMailbox && connectedAccounts.length === 0
                    ? "Connect Gmail or Outlook in Settings to begin."
                    : "This view is clear. A rare and lovely thing."}
                </p>
                {realMailbox && connectedAccounts.length === 0 ? (
                  <button
                    className="empty-connect"
                    type="button"
                    onClick={() => window.location.assign("/settings")}
                  >
                    Connect an account
                  </button>
                ) : null}
              </div>
            )}
          </div>

          <nav className="mobile-tabbar mobile-only" aria-label="Primary">
            <button className="active" type="button">
              <Inbox size={20} />
              Mail
            </button>
            <button type="button" onClick={() => setSearchOpen(true)}>
              <Search size={20} />
              Search
            </button>
            <button className="mobile-compose" type="button" onClick={openComposer}>
              <Plus size={23} />
            </button>
            <button type="button">
              <Bell size={20} />
              Later
            </button>
            <button type="button" onClick={() => setMenuOpen(true)}>
              <Menu size={20} />
              More
            </button>
          </nav>
        </section>

        {selected ? (
          <section className="thread-panel" key={selected.id}>
            <header className="thread-header">
              <IconButton
                className="mobile-only"
                label="Back to inbox"
                onClick={() => setMobileThreadOpen(false)}
              >
                <ArrowLeft size={20} />
              </IconButton>
              <div className="thread-heading">
                <span className="conversation-kicker">
                  <i style={{ background: accounts[selected.account].color }} />
                  {selected.sourceEmail || accounts[selected.account].email}
                </span>
                <h2>{selected.subject}</h2>
              </div>
              <div className="thread-actions">
                <IconButton label="Snooze">
                  <Clock3 size={17} />
                </IconButton>
                <IconButton
                  label="Archive"
                  onClick={() => archiveThread(selected.id)}
                >
                  <Archive size={17} />
                </IconButton>
                <IconButton label="More">
                  <MoreHorizontal size={18} />
                </IconButton>
              </div>
            </header>

            <div className="conversation-scroll">
              <div className="conversation-date">
                <span>Conversation</span>
              </div>

              <div className="message-stream">
                {selected.messages.map((message, index) => (
                  <article
                    className={`message-card ${
                      message.outgoing ? "outgoing" : "incoming"
                    }`}
                    key={message.id}
                    style={{ "--message-delay": `${index * 90}ms` } as CSSProperties}
                  >
                    <header>
                      <div className="mini-avatar">
                        {message.outgoing ? "RB" : selected.initials}
                      </div>
                      <span>
                        <strong>{message.author}</strong>
                        <small>{message.email}</small>
                      </span>
                      <time>{message.time}</time>
                      <IconButton label="Message options">
                        <MoreHorizontal size={16} />
                      </IconButton>
                    </header>
                    <div className="message-body">
                      {message.body.split("\n").map((line, lineIndex) =>
                        line ? <p key={lineIndex}>{line}</p> : <br key={lineIndex} />,
                      )}
                    </div>
                    {selected.id === "invoice" && index === 0 ? (
                      <button className="attachment-card" type="button">
                        <span>
                          <FileText size={19} />
                        </span>
                        <span>
                          <strong>Invoice-1048-revised.pdf</strong>
                          <small>PDF · 184 KB</small>
                        </span>
                        <ChevronDown size={16} />
                      </button>
                    ) : null}
                  </article>
                ))}
              </div>

              {mailError ? <div className="reply-error">{mailError}</div> : null}
              <div className="smart-nudge">
                <Sparkles size={15} />
                <span>
                  {selected.tag === "Needs reply"
                    ? "This looks like it needs a reply."
                    : "Caught up. Nothing needed from you."}
                </span>
                {selected.tag === "Needs reply" ? (
                  <button type="button" onClick={() => replyInput.current?.focus()}>
                    Draft it
                  </button>
                ) : null}
              </div>
            </div>

            <footer className="reply-dock">
              <div className="reply-box">
                <div className="reply-mode">
                  <button type="button">
                    <Reply size={14} />
                    Reply to {selected.sender.split(" ")[0]}
                    <ChevronDown size={13} />
                  </button>
                  <span>from {selected.sourceEmail || accounts[selected.account].email}</span>
                </div>
                <textarea
                  ref={replyInput}
                  value={reply}
                  rows={2}
                  aria-label="Write a reply"
                  placeholder="Write a reply…"
                  onChange={(event) => setReply(event.target.value)}
                  onKeyDown={(event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      void sendReply();
                    }
                  }}
                />
                <div className="composer-actions">
                  <div>
                    <IconButton label="Attach a file">
                      <Paperclip size={17} />
                    </IconButton>
                    <IconButton label="Insert mention">
                      <AtSign size={17} />
                    </IconButton>
                    <IconButton label="Writing tools">
                      <Sparkles size={17} />
                    </IconButton>
                  </div>
                  <button
                    className={`send-button ${reply.trim() ? "ready" : ""}`}
                    type="button"
                    onClick={() => void sendReply()}
                    disabled={!reply.trim() || sending}
                  >
                    {sent ? (
                      <Check size={17} />
                    ) : sending ? (
                      <Clock3 size={16} />
                    ) : (
                      <Send size={16} />
                    )}
                    <span>{sent ? "Sent" : sending ? "Sending" : "Send"}</span>
                    <kbd>⌘↵</kbd>
                  </button>
                </div>
              </div>
            </footer>
          </section>
        ) : (
          <section className="thread-panel no-selection">
            <MessageCircle size={28} />
            <p>Choose a conversation</p>
          </section>
        )}
      </section>

      {composeOpen ? (
        <div className="compose-layer" role="dialog" aria-modal="true" aria-label="New message">
          <button
            className="search-scrim"
            type="button"
            aria-label="Close composer"
            onClick={() => setComposeOpen(false)}
          />
          <section className="compose-modal">
            <header>
              <div>
                <span>New conversation</span>
                <h2>Write a message</h2>
              </div>
              <IconButton label="Close composer" onClick={() => setComposeOpen(false)}>
                <X size={18} />
              </IconButton>
            </header>
            {connectedAccounts.length > 1 ? (
              <label>
                From
                <select
                  value={compose.accountId}
                  onChange={(event) =>
                    setCompose((current) => ({
                      ...current,
                      accountId: event.target.value,
                    }))
                  }
                >
                  {connectedAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.email}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="compose-from">
                From {connectedAccounts[0]?.email || accounts.personal.email}
              </p>
            )}
            <label>
              To
              <input
                autoFocus
                type="email"
                value={compose.to}
                placeholder="name@example.com"
                onChange={(event) =>
                  setCompose((current) => ({ ...current, to: event.target.value }))
                }
              />
            </label>
            <label>
              Subject
              <input
                value={compose.subject}
                placeholder="What’s this about?"
                onChange={(event) =>
                  setCompose((current) => ({
                    ...current,
                    subject: event.target.value,
                  }))
                }
              />
            </label>
            <textarea
              value={compose.body}
              placeholder="Write like you’re talking to someone."
              onChange={(event) =>
                setCompose((current) => ({ ...current, body: event.target.value }))
              }
            />
            {composeError ? <div className="settings-error">{composeError}</div> : null}
            <footer>
              <div>
                <IconButton label="Attach a file">
                  <Paperclip size={17} />
                </IconButton>
              </div>
              <button
                className="settings-primary"
                type="button"
                disabled={
                  composeBusy ||
                  !compose.to.trim() ||
                  !compose.subject.trim() ||
                  !compose.body.trim()
                }
                onClick={() => void sendNewMessage()}
              >
                {composeBusy ? <Clock3 size={16} /> : <Send size={16} />}
                {composeBusy ? "Sending" : "Send message"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {searchOpen ? (
        <div
          className="search-layer"
          role="dialog"
          aria-modal="true"
          aria-label="Search all mail"
        >
          <button
            className="search-scrim"
            aria-label="Close search"
            type="button"
            onClick={() => setSearchOpen(false)}
          />
          <section className="search-command">
            <header>
              <Sparkles size={19} />
              <input
                ref={searchInput}
                value={searchQuery}
                placeholder="What are you looking for?"
                aria-label="Search query"
                onChange={(event) => setSearchQuery(event.target.value)}
              />
              <kbd>esc</kbd>
            </header>
            {searchQuery ? (
              <div className="intent-reading">
                <span>rb/mail understood</span>
                <div>
                  <em>Across both accounts</em>
                  {/invoice|payment|paid|money|amount/i.test(searchQuery) ? (
                    <em>Money & invoices</em>
                  ) : null}
                  {/last month|june|july|yesterday/i.test(searchQuery) ? (
                    <em>Recent</em>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="query-suggestions">
                <span>Try asking</span>
                {[
                  "the revised invoice from last month",
                  "travel confirmations for Tokyo",
                  "what do I still need to reply to?",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => setSearchQuery(suggestion)}
                  >
                    {suggestion}
                    <span>↗</span>
                  </button>
                ))}
              </div>
            )}
            <div className="search-results">
              <div className="result-label">
                <span>{searchQuery ? "Best matches" : "Recent conversations"}</span>
                <small>
                  {semanticStatus === "ready"
                    ? "on-device semantic · all accounts"
                    : semanticStatus === "loading"
                      ? "warming local model…"
                      : semanticStatus === "fallback"
                        ? "private intent search · all accounts"
                        : "type to search on-device"}
                </small>
              </div>
              {semanticResults.slice(0, 4).map((thread, index) => (
                <button
                  type="button"
                  className="search-result"
                  key={thread.id}
                  onClick={() => {
                    void chooseThread(thread.id);
                    setSearchOpen(false);
                  }}
                >
                  <span
                    className="avatar"
                    style={{ background: thread.avatarTone }}
                  >
                    {thread.initials}
                    <i style={{ background: accounts[thread.account].color }} />
                  </span>
                  <span>
                    <strong>{thread.subject}</strong>
                    <small>
                      {thread.sender} · {thread.preview}
                    </small>
                  </span>
                  <em>{index === 0 && searchQuery ? "92%" : thread.time}</em>
                </button>
              ))}
            </div>
            <footer>
              <span>
                <Command size={13} /> K to search anywhere
              </span>
              <span>Your query stays on this device</span>
            </footer>
          </section>
        </div>
      ) : null}
    </main>
  );
}
