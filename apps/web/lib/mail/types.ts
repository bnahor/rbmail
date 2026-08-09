export type Provider = "google" | "microsoft";

export type AuthBackend = "direct" | "composio";

export type MailAddress = {
  name: string;
  address: string;
};

export type MailAttachment = {
  id: string;
  providerAttachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  contentId: string | null;
  disposition: "inline" | "attachment";
  inline: boolean;
  contentBase64?: string;
};

export type MailHeaders = {
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  replyTo: MailAddress[];
  listUnsubscribe: string | null;
};

export type MIMEPart = {
  id: string;
  mimeType: string;
  filename: string;
  disposition: "inline" | "attachment" | null;
  contentId: string | null;
  size: number;
  providerAttachmentId: string | null;
  charset: string | null;
  transferEncoding: string | null;
  children: MIMEPart[];
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
  bcc: MailAddress[];
  receivedAt: string;
  isRead: boolean;
  flagged: boolean;
  hasAttachments: boolean;
  attachments: MailAttachment[];
  headers: MailHeaders;
  mimeTree: MIMEPart | null;
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
  userId: string | null;
  provider: Provider;
  providerAccountId: string;
  email: string;
  displayName: string;
  authBackend: AuthBackend;
  connectedAccountId: string | null;
  token: StoredToken;
  syncCursor: string | null;
  status: "connected" | "syncing" | "error" | "reauth_required";
  lastSyncAt: number | null;
};

export type AccountCapabilities = {
  mail: boolean;
  calendar: boolean;
};

export type PublicAccount = Omit<
  StoredAccount,
  "token" | "syncCursor" | "userId" | "connectedAccountId"
> & {
  capabilities: AccountCapabilities;
};

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
  flagged: boolean;
  archived: boolean;
  snoozedUntil: string | null;
  muted: boolean;
  vip: boolean;
  syncVersion: number;
  attachmentCount: number;
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

export type Mailbox = {
  id: string;
  accountId: string;
  provider: Provider;
  name: string;
  kind:
    | "inbox"
    | "sent"
    | "drafts"
    | "archive"
    | "junk"
    | "trash"
    | "label"
    | "folder";
  unreadCount: number;
  system: boolean;
};

export type MailAction =
  | "read"
  | "unread"
  | "flag"
  | "unflag"
  | "archive"
  | "trash"
  | "restore"
  | "junk"
  | "not_junk"
  | "mute"
  | "unmute"
  | "vip"
  | "unvip"
  | "snooze"
  | "unsnooze";

export type RecipientSet = {
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
};

export type OutgoingAttachment = {
  filename: string;
  mimeType: string;
  contentBase64: string;
  contentId?: string;
  inline?: boolean;
};

export type ComposeMessageInput = {
  accountId: string;
  recipients: RecipientSet;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  attachments?: OutgoingAttachment[];
  threadId?: string;
  replyToMessageId?: string;
  inReplyTo?: string;
  references?: string[];
  replyMode?: "reply" | "replyAll" | "forward";
  sendAt?: string;
};

export type Draft = ComposeMessageInput & {
  id: string;
  userId: string;
  state: "draft" | "queued" | "sending" | "sent" | "failed";
  error: string | null;
  createdAt: number;
  updatedAt: number;
};

export type NotificationPreferences = {
  enabled: boolean;
  scope: "all" | "priority" | "custom";
  accountIds: string[];
  showSender: boolean;
  showSubject: boolean;
  showBody: boolean;
  sound: boolean;
  badge: boolean;
  calendarReminders: boolean;
};

export type CalendarAccessRole = "reader" | "writer" | "owner";

export type CalendarSource = {
  id: string;
  accountId: string;
  provider: Provider;
  accountEmail: string;
  providerCalendarId: string;
  name: string;
  color: string;
  timeZone: string;
  accessRole: CalendarAccessRole;
  primary: boolean;
  selected: boolean;
  status: "connected" | "syncing" | "error" | "reauth_required";
  lastSyncAt: number | null;
};

export type StoredCalendarSource = CalendarSource & {
  syncCursor: string | null;
  windowStart: string | null;
  windowEnd: string | null;
};

export type CalendarAttendee = MailAddress & {
  optional: boolean;
  responseStatus: "needsAction" | "accepted" | "tentative" | "declined";
  self?: boolean;
};

export type CalendarEventSummary = {
  id: string;
  sourceId: string;
  accountId: string;
  provider: Provider;
  accountEmail: string;
  calendarName: string;
  calendarColor: string;
  providerEventId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  status: "confirmed" | "tentative" | "cancelled";
  responseStatus: "needsAction" | "accepted" | "tentative" | "declined";
  location: string;
  joinUrl: string | null;
  conferenceProvider: "meet" | "teams" | null;
  editable: boolean;
  etag: string | null;
};

export type CalendarEventDetail = CalendarEventSummary & {
  description: string;
  organizer: MailAddress;
  attendees: CalendarAttendee[];
  recurring: boolean;
  htmlLink: string | null;
};

export type CreateCalendarEventInput = {
  sourceId: string;
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  timeZone?: string;
  attendeeEmails?: string[];
  description?: string;
  location?: string;
  onlineMeeting?: boolean;
  sourceThreadId?: string;
};

export type UpdateCalendarEventInput = Partial<
  Omit<CreateCalendarEventInput, "sourceId" | "sourceThreadId">
> & {
  etag?: string | null;
};

export type EventResponse = "accepted" | "tentative" | "declined";

export type CalendarSyncResult = {
  sourceId: string;
  processed: number;
  mode: "initial" | "incremental";
};
