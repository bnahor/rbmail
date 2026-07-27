export type Provider = "google" | "microsoft";

export type MailAddress = {
  name: string;
  address: string;
};

export type NormalizedMessage = {
  id: string;
  providerId: string;
  providerThreadId: string;
  subject: string;
  snippet: string;
  bodyText: string;
  bodyHtml: string | null;
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  receivedAt: string;
  isRead: boolean;
  hasAttachments: boolean;
  labels: string[];
  folder?: string;
};

export type StoredToken = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope?: string;
  tokenType?: string;
};

export type StoredAccount = {
  id: string;
  provider: Provider;
  providerAccountId: string;
  email: string;
  displayName: string;
  token: StoredToken;
  syncCursor: string | null;
  status: "connected" | "syncing" | "error" | "reauth_required";
  lastSyncAt: number | null;
};

export type PublicAccount = Omit<StoredAccount, "token" | "syncCursor">;

export type ThreadSummary = {
  id: string;
  accountId: string;
  provider: Provider;
  providerThreadId: string;
  email: string;
  displayName: string;
  subject: string;
  snippet: string;
  participants: MailAddress[];
  labels: string[];
  lastMessageAt: string;
  unread: boolean;
  messageCount: number;
};

export type ThreadDetail = ThreadSummary & {
  messages: NormalizedMessage[];
};

export type SyncResult = {
  accountId: string;
  processed: number;
  hasMore: boolean;
  mode: "initial" | "incremental";
};
