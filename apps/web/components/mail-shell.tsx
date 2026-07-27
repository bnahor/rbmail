"use client";

import {
  Archive,
  ArrowLeft,
  Bookmark,
  CalendarDays,
  Check,
  Clock3,
  Command,
  Inbox,
  Mail,
  Menu,
  MessageCircle,
  PenLine,
  Plane,
  Plus,
  Receipt,
  Reply,
  Search,
  Send,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  CalendarWorkspace,
  type ScheduleSeed,
} from "@/components/calendar-workspace";
import {
  accounts,
  initialThreads,
  type AccountId,
  type MailThread,
} from "@/lib/mock-mail";
import type {
  CalendarEventSummary,
  PublicAccount,
  ThreadDetail,
  ThreadSummary,
} from "@/lib/mail/types";

type AccountFilter = "all" | string;
type ViewId = "inbox" | "today" | "reply" | "receipts" | "travel" | "later";

type UiAccount = {
  id: string;
  slot: AccountId;
  provider: "google" | "microsoft";
  label: string;
  email: string;
  color: string;
  unread: number;
  capabilities: PublicAccount["capabilities"];
};

type ArchivedThread = {
  thread: MailThread;
  index: number;
};

const avatarTones = ["#d9f2cc", "#d7e4ff", "#f5d7ec", "#ffe2b6", "#e7ddff"];

function stableTone(value: string) {
  const hash = Array.from(value).reduce(
    (total, character) => (total * 31 + character.charCodeAt(0)) >>> 0,
    0,
  );
  return avatarTones[hash % avatarTones.length];
}

function providerName(provider?: "google" | "microsoft") {
  return provider === "microsoft" ? "Outlook" : "Gmail";
}

function threadProvider(thread: Pick<MailThread, "provider" | "account">) {
  return thread.provider ?? (thread.account === "studio" ? "microsoft" : "google");
}

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

function eventTimeForSearch(
  event: Pick<CalendarEventSummary, "start" | "allDay">,
) {
  const date = new Date(event.start);
  const day = date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
  if (event.allDay) return `${day} · All day`;
  return `${day} · ${date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function cleanDisplayText(value: string): string {
  return value
    .replace(
      /&(#(?:x[0-9a-f]+|\d+)|amp|apos|gt|lt|nbsp|quot);/gi,
      (entity, code: string) => {
        const namedEntities: Record<string, string> = {
          amp: "&",
          apos: "'",
          gt: ">",
          lt: "<",
          nbsp: " ",
          quot: '"',
        };
        if (!code.startsWith("#")) {
          return namedEntities[code.toLowerCase()] ?? entity;
        }

        const numericCode = code.slice(1);
        const hexadecimal = numericCode[0]?.toLowerCase() === "x";
        const point = Number.parseInt(
          numericCode.slice(hexadecimal ? 1 : 0),
          hexadecimal ? 16 : 10,
        );
        if (!Number.isFinite(point) || point < 0 || point > 0x10ffff) {
          return entity;
        }
        try {
          return String.fromCodePoint(point);
        } catch {
          return entity;
        }
      },
    )
    .replace(
      /[\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g,
      "",
    )
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function buildEmailDocument(html: string): string {
  const safeMarkup = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(
      /<(iframe|object|embed|form)\b[^>]*>[\s\S]*?<\/\1>/gi,
      "",
    )
    .replace(/<(?:input|button|textarea|select|meta|base)\b[^>]*>/gi, "")
    .replace(
      /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
      "",
    );
  const styles = (
    safeMarkup.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) ?? []
  ).join("\n");
  const bodyMatch = safeMarkup.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const content = (bodyMatch?.[1] ?? safeMarkup)
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<\/?(?:html|head|body)\b[^>]*>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="color-scheme" content="light">
    <meta name="referrer" content="no-referrer">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline' https: http:; font-src data: https: http:; media-src data: https: http:; script-src 'none'; frame-src 'none'; object-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'">
    <base target="_blank">
    ${styles}
    <style>
      :root { color-scheme: light; }
      html, body { min-width: 0 !important; max-width: 100% !important; margin: 0 !important; background: #fff !important; color: #252521; }
      body { overflow-wrap: anywhere; font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.55; }
      img { max-width: 100% !important; height: auto !important; }
      table { max-width: 100% !important; }
      pre { max-width: 100%; overflow: auto; white-space: pre-wrap; }
      a { color: #315cce; }
      .rbmail-email-root { width: 100%; min-width: 0; overflow: hidden; }
    </style>
  </head>
  <body><div class="rbmail-email-root">${content}</div></body>
</html>`;
}

function inferTag(thread: ThreadSummary) {
  const text = `${thread.subject} ${thread.snippet} ${thread.labels.join(" ")}`.toLowerCase();
  if (/invoice|receipt|payment|bank|paid/.test(text)) return "Finance";
  if (/flight|hotel|booking|travel|trip/.test(text)) return "Travel";
  if (/newsletter|digest|weekly|issue/.test(text)) return "Read later";
  return thread.unread ? "Needs attention" : undefined;
}

function mapSummary(thread: ThreadSummary): MailThread {
  const slot: AccountId =
    thread.provider === "microsoft" ? "studio" : "personal";
  const sender =
    thread.participants.find(
      (participant) => participant.address.toLowerCase() !== thread.email.toLowerCase(),
    ) ?? thread.participants[0];
  const senderName = sender?.name || sender?.address || "Unknown sender";
  return {
    id: thread.id,
    sender: senderName,
    initials: initials(senderName),
    subject: cleanDisplayText(thread.subject),
    preview: cleanDisplayText(thread.snippet),
    time: displayTime(thread.lastMessageAt),
    sortTime: new Date(thread.lastMessageAt).getTime(),
    account: slot,
    remoteAccountId: thread.accountId,
    sourceEmail: thread.email,
    provider: thread.provider,
    participants: thread.participants,
    unread: thread.unread,
    tag: inferTag(thread),
    avatarTone: stableTone(`${thread.accountId}:${senderName}`),
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
      body: cleanDisplayText(message.bodyText || message.snippet),
      html: message.bodyHtml,
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
  { id: "inbox", label: "Current", icon: Inbox, count: 7 },
  { id: "today", label: "Today", icon: CalendarDays },
  { id: "reply", label: "Needs attention", icon: MessageCircle },
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

function RichMessageBody({
  html,
  fallback,
  author,
  subject,
}: {
  html?: string | null;
  fallback: string;
  author: string;
  subject: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const [height, setHeight] = useState(220);
  const [fullHeight, setFullHeight] = useState(220);
  const [expanded, setExpanded] = useState(false);
  const document = useMemo(
    () => (html ? buildEmailDocument(html) : ""),
    [html],
  );

  useEffect(
    () => () => {
      observer.current?.disconnect();
    },
    [],
  );

  if (!html) {
    return (
      <div className="message-body message-body-plain">
        {fallback.split("\n").map((line, lineIndex) =>
          line ? <p key={lineIndex}>{line}</p> : <br key={lineIndex} />,
        )}
      </div>
    );
  }

  function fitFrame() {
    const body = frame.current?.contentDocument?.body;
    if (!body) return;
    const measuredHeight = Math.max(180, body.scrollHeight, body.offsetHeight);
    setFullHeight(measuredHeight);
    setHeight(expanded ? measuredHeight : Math.min(960, measuredHeight));
    observer.current?.disconnect();
    observer.current = new ResizeObserver(() => {
      const nextBody = frame.current?.contentDocument?.body;
      if (!nextBody) return;
      const measured = Math.max(
        180,
        nextBody.scrollHeight,
        nextBody.offsetHeight,
      );
      setFullHeight(measured);
      setHeight(expanded ? measured : Math.min(960, measured));
    });
    observer.current.observe(body);
  }

  return (
    <div className="message-body message-body-rich">
      <iframe
        ref={frame}
        className="rich-message-frame"
        srcDoc={document}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        title={`Message from ${author}: ${subject}`}
        style={{ height }}
        onLoad={fitFrame}
      />
      {fullHeight > 960 && !expanded ? (
        <button
          className="show-full-message"
          type="button"
          onClick={() => {
            setExpanded(true);
            setHeight(fullHeight);
          }}
        >
          Show full message
        </button>
      ) : null}
    </div>
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
  const [scheduleSeed, setScheduleSeed] = useState<ScheduleSeed | null>(null);
  const [calendarSearchResults, setCalendarSearchResults] = useState<
    CalendarEventSummary[]
  >([]);
  const [calendarTargetId, setCalendarTargetId] = useState<string | null>(null);
  const [realMailbox, setRealMailbox] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [archivedThread, setArchivedThread] = useState<ArchivedThread | null>(
    null,
  );
  const [connectedAccounts, setConnectedAccounts] = useState<UiAccount[]>(
    Object.values(accounts).map((account) => ({
      id: account.id,
      slot: account.id,
      provider: account.id === "studio" ? "microsoft" : "google",
      label: account.label,
      email: account.email,
      color: account.color,
      unread: account.unread,
      capabilities: { mail: true, calendar: false },
    })),
  );
  const archiveTimer = useRef<number | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const replyInput = useRef<HTMLTextAreaElement>(null);
  const modalReturnFocus = useRef<HTMLElement | null>(null);
  const semanticWorker = useRef<Worker | null>(null);
  const indexedSignature = useRef("");

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("preview")) return;
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
      const nextThreads = threadPayload.threads.map(mapSummary);
      const nextAccounts = accountPayload.accounts.map((account) => {
        const slot: AccountId =
          account.provider === "microsoft" ? "studio" : "personal";
        return {
          id: account.id,
          slot,
          provider: account.provider,
          label: account.displayName || (account.provider === "google" ? "Google" : "Outlook"),
          email: account.email,
          color: account.provider === "microsoft" ? "#5278d8" : "#d94b35",
          unread: nextThreads.filter(
            (thread) => thread.remoteAccountId === account.id && thread.unread,
          ).length,
          capabilities: account.capabilities,
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
        if (activeView === "reply") return thread.unread;
        if (activeView === "receipts")
          return thread.tag === "Finance" || thread.tag === "Receipt";
        if (activeView === "travel") return thread.tag === "Travel";
        if (activeView === "later") return thread.tag === "Read later";
        return true;
      });
  }, [accountFilter, activeView, threads]);

  const selected =
    threads.find((thread) => thread.id === selectedId) ?? filteredThreads[0];

  const groupedThreads = useMemo(() => {
    const attention = filteredThreads.filter((thread) => thread.unread);
    const updates = filteredThreads.filter(
      (thread) =>
        !thread.unread &&
        ["Finance", "Receipt", "Travel", "Read later"].includes(
          thread.tag ?? "",
        ),
    );
    const groupedIds = new Set(
      [...attention, ...updates].map((thread) => thread.id),
    );
    const earlier = filteredThreads.filter(
      (thread) => !groupedIds.has(thread.id),
    );
    return [
      { id: "attention", label: "Needs attention", threads: attention },
      { id: "updates", label: "Updates", threads: updates },
      { id: "earlier", label: "Earlier", threads: earlier },
    ].filter((group) => group.threads.length);
  }, [filteredThreads]);

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
      return threads.filter((thread) => thread.unread);
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
    if (!searchOpen || !searchQuery.trim() || !realMailbox) {
      setCalendarSearchResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const to = new Date();
      to.setMonth(to.getMonth() + 6);
      const response = await fetch(
        `/api/calendar/events?from=${encodeURIComponent(
          from.toISOString(),
        )}&to=${encodeURIComponent(to.toISOString())}&q=${encodeURIComponent(
          searchQuery.trim(),
        )}`,
        { signal: controller.signal },
      ).catch(() => null);
      if (!response?.ok) return;
      const payload = (await response.json()) as {
        events: CalendarEventSummary[];
      };
      setCalendarSearchResults(payload.events.slice(0, 4));
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [realMailbox, searchOpen, searchQuery]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isTyping =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (
        ((event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "k") ||
        (event.key === "/" && !isTyping)
      ) {
        event.preventDefault();
        modalReturnFocus.current = document.activeElement as HTMLElement;
        setSearchOpen(true);
      }
      if (event.key.toLowerCase() === "c" && !isTyping) {
        event.preventDefault();
        openComposer();
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setComposeOpen(false);
        setMenuOpen(false);
        modalReturnFocus.current?.focus();
      }
      if (isTyping || searchOpen || activeView === "today") return;
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

  useEffect(() => {
    if (!searchOpen && !composeOpen) return;
    const selector = searchOpen ? ".search-command" : ".compose-modal";
    const trapFocus = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const dialog = document.querySelector<HTMLElement>(selector);
      const focusable = Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", trapFocus);
    return () => window.removeEventListener("keydown", trapFocus);
  }, [composeOpen, searchOpen]);

  useEffect(() => {
    const resetResponsiveState = () => {
      if (window.innerWidth >= 700) {
        setMobileThreadOpen(false);
        setMenuOpen(false);
      }
    };
    window.addEventListener("resize", resetResponsiveState);
    return () => window.removeEventListener("resize", resetResponsiveState);
  }, []);

  async function chooseThread(id: string) {
    setSelectedId(id);
    if (window.innerWidth < 700) setMobileThreadOpen(true);
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

  async function commitArchive(entry: ArchivedThread) {
    if (!entry.thread.remoteAccountId) return;
    const response = await fetch(
      `/api/threads/${encodeURIComponent(entry.thread.id)}/action`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "archive" }),
      },
    );
    if (!response.ok) {
      setThreads((current) => {
        if (current.some((thread) => thread.id === entry.thread.id)) {
          return current;
        }
        const restored = [...current];
        restored.splice(Math.min(entry.index, restored.length), 0, entry.thread);
        return restored;
      });
      setMailError("Archive failed. The conversation was restored.");
    }
  }

  function archiveThread(id: string) {
    const thread = threads.find((candidate) => candidate.id === id);
    if (!thread || archivingId === id) return;
    if (archiveTimer.current && archivedThread) {
      window.clearTimeout(archiveTimer.current);
      void commitArchive(archivedThread);
    }
    const index = threads.findIndex((candidate) => candidate.id === id);
    setArchivingId(id);
    window.setTimeout(() => {
      const entry = { thread, index };
      setThreads((current) =>
        current.filter((candidate) => candidate.id !== id),
      );
      const remaining = filteredThreads.filter(
        (candidate) => candidate.id !== id,
      );
      if (selectedId === id) setSelectedId(remaining[0]?.id ?? "");
      if (window.innerWidth < 700) setMobileThreadOpen(false);
      setArchivingId(null);
      setArchivedThread(entry);
      archiveTimer.current = window.setTimeout(() => {
        void commitArchive(entry);
        setArchivedThread(null);
        archiveTimer.current = null;
      }, 5000);
    }, 160);
  }

  function undoArchive() {
    if (!archivedThread) return;
    if (archiveTimer.current) window.clearTimeout(archiveTimer.current);
    setThreads((current) => {
      const restored = [...current];
      restored.splice(
        Math.min(archivedThread.index, restored.length),
        0,
        archivedThread.thread,
      );
      return restored;
    });
    setSelectedId(archivedThread.thread.id);
    setArchivedThread(null);
    archiveTimer.current = null;
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
    modalReturnFocus.current = document.activeElement as HTMLElement;
    setComposeOpen(true);
  }

  function closeComposer() {
    setComposeOpen(false);
    window.setTimeout(() => modalReturnFocus.current?.focus(), 0);
  }

  function openSearch() {
    modalReturnFocus.current = document.activeElement as HTMLElement;
    setSearchOpen(true);
  }

  function closeSearch() {
    setSearchOpen(false);
    window.setTimeout(() => modalReturnFocus.current?.focus(), 0);
  }

  function scheduleThread(thread: MailThread) {
    const ownAddresses = new Set(
      connectedAccounts.map((account) => account.email.toLowerCase()),
    );
    const attendeeEmails = (thread.participants || [])
      .map((participant) => participant.address.trim().toLowerCase())
      .filter((address) => address && !ownAddresses.has(address));
    setScheduleSeed({
      threadId: thread.id,
      title: thread.subject,
      attendeeEmails: [...new Set(attendeeEmails)],
      accountId: thread.remoteAccountId,
    });
    setActiveView("today");
    setMobileThreadOpen(false);
  }

  const handleScheduleHandled = useCallback(() => {
    setScheduleSeed(null);
  }, []);

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
    const threadId = selected.id;
    const optimisticId = `reply-${Date.now()}`;
    setMailError("");
    setReply("");
    setSending(true);
    setThreads((current) =>
      current.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              preview: text,
              messages: [
                ...thread.messages,
                {
                  id: optimisticId,
                  author: "You",
                  email: thread.sourceEmail || accounts[thread.account].email,
                  time: "Now",
                  body: text,
                  outgoing: true,
                  pending: Boolean(thread.remoteAccountId),
                },
              ],
            }
          : thread,
      ),
    );
    if (selected.remoteAccountId) {
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
        setThreads((current) =>
          current.map((thread) =>
            thread.id === threadId
              ? {
                  ...thread,
                  messages: thread.messages.map((message) =>
                    message.id === optimisticId
                      ? { ...message, pending: false, failed: true }
                      : message,
                  ),
                }
              : thread,
          ),
        );
        return;
      }
    }
    setSending(false);
    setThreads((current) =>
      current.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              messages: thread.messages.map((message) =>
                message.id === optimisticId
                  ? { ...message, pending: false }
                  : message,
              ),
            }
          : thread,
      ),
    );
    setSent(true);
    window.setTimeout(() => setSent(false), 1800);
  }

  const unreadTotal = threads.filter((thread) => thread.unread).length;

  return (
    <main className="mail-stage">
      <section
        className={`mail-app ${mobileThreadOpen ? "mobile-thread-open" : ""}`}
        aria-label="Unified mail application"
      >
        <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
          <div className="brand-row">
            <div className="brand-mark">R</div>
            <div>
              <strong>rb/mail</strong>
              <span>all your conversations</span>
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
                  {view.id === "inbox" || view.id === "reply" ? (
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
                    <Mail size={14} />
                  </span>
                  <span>
                    <strong>{account.label}</strong>
                    <small>{providerName(account.provider)} · {account.email}</small>
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

        {activeView === "today" ? (
          <CalendarWorkspace
            accountFilter={accountFilter}
            accounts={connectedAccounts}
            scheduleSeed={scheduleSeed}
            initialEventId={calendarTargetId}
            onScheduleHandled={handleScheduleHandled}
            onOpenMenu={() => setMenuOpen(true)}
            onBack={() => setMobileThreadOpen(false)}
          />
        ) : (
          <>
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
              <button
                className="all-account-pill"
                type="button"
                aria-label="Show all accounts"
                onClick={() => setAccountFilter("all")}
              >
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
                {accountFilter !== "all" ? <X size={13} /> : null}
              </button>
            </div>

            <button
              className="search-trigger"
              type="button"
              onClick={openSearch}
            >
              <Search size={17} />
              <span>Ask anything about your mail</span>
              <kbd>⌘ K</kbd>
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
          </div>

          <ul className="thread-list" aria-label="Conversations">
            {filteredThreads.length ? (
              groupedThreads.flatMap((group, groupIndex) => [
                <li className="thread-group-label" key={`${group.id}-label`}>
                  <span>{group.label}</span>
                  <em>{group.threads.length}</em>
                </li>,
                ...group.threads.map((thread, threadIndex) => {
                  const providerId = threadProvider(thread);
                  const provider = providerName(providerId);
                  const animationIndex = groupIndex * 2 + threadIndex;
                  return (
                    <li
                      className={`thread-swipe-wrap ${
                        archivingId === thread.id ? "archiving" : ""
                      }`}
                      key={thread.id}
                      style={{
                        "--row-delay": `${Math.min(animationIndex, 6) * 22}ms`,
                      } as CSSProperties}
                    >
                      <button
                        className={`thread-row ${
                          selected?.id === thread.id ? "selected" : ""
                        } ${thread.unread ? "unread" : ""}`}
                        type="button"
                        aria-current={selected?.id === thread.id ? "true" : undefined}
                        aria-label={`${thread.unread ? "Unread, " : ""}${thread.sender}, ${thread.subject}, ${thread.time}, ${provider}`}
                        onClick={() => void chooseThread(thread.id)}
                      >
                        <span
                          className="avatar"
                          style={{ background: thread.avatarTone }}
                        >
                          {thread.initials}
                          <i
                            className={`provider-mark provider-${providerId}`}
                            title={provider}
                          >
                            <Mail size={9} />
                          </i>
                        </span>
                        <span className="thread-copy">
                          <span className="thread-meta">
                            <strong>{thread.sender}</strong>
                            <time>{thread.time}</time>
                          </span>
                          <span className="thread-subject">{thread.subject}</span>
                          <span className="thread-preview">{thread.preview}</span>
                        </span>
                        {thread.unread ? (
                          <span className="unread-indicator" aria-hidden="true">
                            New
                          </span>
                        ) : null}
                      </button>
                      <div className="row-action-rail">
                        <IconButton
                          label={`Archive ${thread.subject}`}
                          onClick={() => archiveThread(thread.id)}
                        >
                          <Archive size={15} />
                        </IconButton>
                      </div>
                    </li>
                  );
                }),
              ])
            ) : (
              <li className="empty-view">
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
              </li>
            )}
          </ul>

        </section>

        {selected ? (
          <section className="thread-panel">
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
                  <Mail size={13} />
                  {providerName(threadProvider(selected))}
                  <span aria-hidden="true">·</span>
                  {selected.sourceEmail || accounts[selected.account].email}
                </span>
                <h2>{selected.subject}</h2>
                {selected.participants?.length ? (
                  <div className="participant-chips" aria-label="Participants">
                    {selected.participants.slice(0, 3).map((participant) => (
                      <span key={participant.address}>
                        {participant.name || participant.address}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="thread-actions">
                <IconButton
                  label="Schedule"
                  onClick={() => scheduleThread(selected)}
                >
                  <CalendarDays size={17} />
                </IconButton>
                <IconButton
                  label="Archive"
                  onClick={() => archiveThread(selected.id)}
                >
                  <Archive size={17} />
                </IconButton>
              </div>
            </header>

            <div className="conversation-scroll">
              <div className="conversation-date">
                <span>Conversation</span>
              </div>

              <div className="message-stream">
                {selected.messages.map((message) => (
                  <article
                    className={`message-card ${
                      message.outgoing ? "outgoing" : "incoming"
                    } ${message.html ? "has-rich-content" : ""} ${
                      message.pending ? "pending" : ""
                    } ${message.failed ? "failed" : ""}`}
                    key={message.id}
                  >
                    <header>
                      <div className="mini-avatar">
                        {message.outgoing ? "RB" : selected.initials}
                      </div>
                      <span>
                        <strong>{message.author}</strong>
                        <small>{message.email}</small>
                      </span>
                      <time>
                        {message.failed
                          ? "Couldn’t send"
                          : message.pending
                            ? "Sending…"
                            : message.time}
                      </time>
                    </header>
                    <RichMessageBody
                      html={message.html}
                      fallback={message.body}
                      author={message.author}
                      subject={selected.subject}
                    />
                    <div className="message-action-rail">
                      <IconButton
                        label={`Reply to ${message.author}`}
                        onClick={() => replyInput.current?.focus()}
                      >
                        <Reply size={15} />
                      </IconButton>
                    </div>
                  </article>
                ))}
              </div>

              {mailError ? <div className="reply-error">{mailError}</div> : null}
            </div>

            <footer className="reply-dock">
              <div className="reply-box">
                <div className="reply-mode">
                  <span className="replying-to">
                    <Reply size={14} />
                    Reply to {selected.sender.split(" ")[0]}
                  </span>
                  <span className="replying-as">
                    <Mail size={13} />
                    Replying as {providerName(threadProvider(selected))} ·{" "}
                    {selected.sourceEmail || accounts[selected.account].email}
                  </span>
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
                  <span className="composer-hint">⌘ Enter to send</span>
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
          </>
        )}
      </section>

      {archivedThread ? (
        <div className="undo-toast" role="status" aria-live="polite">
          <span>Conversation archived</span>
          <button type="button" onClick={undoArchive}>
            Undo
          </button>
        </div>
      ) : null}

      {composeOpen ? (
        <div className="compose-layer" role="dialog" aria-modal="true" aria-label="New message">
          <div
            className="search-scrim"
            aria-hidden="true"
            onMouseDown={closeComposer}
          />
          <section className="compose-modal">
            <header>
              <div>
                <span>New conversation</span>
                <h2>Write a message</h2>
              </div>
              <IconButton label="Close composer" onClick={closeComposer}>
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
              <span>⌘ Enter to send</span>
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
          <div
            className="search-scrim"
            aria-hidden="true"
            onMouseDown={closeSearch}
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
              {calendarSearchResults.length ? (
                <>
                  <div className="result-label calendar-result-label">
                    <span>Calendar</span>
                    <small>private local index</small>
                  </div>
                  {calendarSearchResults.map((event) => (
                    <button
                      type="button"
                      className="search-result calendar-search-result"
                      key={event.id}
                      onClick={() => {
                        setCalendarTargetId(event.id);
                        setActiveView("today");
                        closeSearch();
                      }}
                    >
                      <span
                        className="calendar-search-glyph"
                        style={{ "--calendar-color": event.calendarColor } as CSSProperties}
                      >
                        <CalendarDays size={16} />
                      </span>
                      <span>
                        <strong>{event.title}</strong>
                        <small>
                          {event.calendarName} · {eventTimeForSearch(event)}
                        </small>
                      </span>
                      <em>{event.provider === "google" ? "Google" : "Outlook"}</em>
                    </button>
                  ))}
                </>
              ) : null}
              {semanticResults.slice(0, 4).map((thread, index) => (
                <button
                  type="button"
                  className="search-result"
                  key={thread.id}
                  onClick={() => {
                    void chooseThread(thread.id);
                    closeSearch();
                  }}
                >
                  <span
                    className="avatar"
                    style={{ background: thread.avatarTone }}
                  >
                    {thread.initials}
                    <i
                      className={`provider-mark provider-${threadProvider(thread)}`}
                      title={providerName(threadProvider(thread))}
                    >
                      <Mail size={9} />
                    </i>
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
