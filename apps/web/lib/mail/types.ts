export type Provider = "google" | "microsoft";

export type AuthBackend = "direct" | "composio";

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
