export type ThreadListViewFilter = {
  clauses: string[];
  values: Array<string | number | null>;
};

export function threadListViewFilter(
  view: string | undefined,
  now: string,
  isSearching: boolean,
): ThreadListViewFilter {
  if (providerLabelId(view)) return { clauses: [], values: [] };

  switch (view) {
    case "attention":
      return {
        clauses: [
          "t.mailbox_kind = 'inbox'",
          "t.archived = 0",
          "t.unread = 1",
          "(t.snoozed_until IS NULL OR t.snoozed_until <= ?)",
        ],
        values: [now],
      };
    case "archive":
      return { clauses: ["t.mailbox_kind = 'archive'"], values: [] };
    case "sent":
      return { clauses: ["t.mailbox_kind = 'sent'"], values: [] };
    case "drafts":
      return { clauses: ["t.mailbox_kind = 'drafts'"], values: [] };
    case "junk":
      return { clauses: ["t.mailbox_kind = 'junk'"], values: [] };
    case "flagged":
      return { clauses: ["t.flagged = 1"], values: [] };
    case "vip":
      return { clauses: ["t.vip = 1"], values: [] };
    case "snoozed":
      return { clauses: ["t.snoozed_until IS NOT NULL"], values: [] };
    case "trash":
      return { clauses: ["t.mailbox_kind = 'trash'"], values: [] };
    default:
      if (isSearching) return { clauses: [], values: [] };
      return {
        clauses: [
          "t.mailbox_kind = 'inbox'",
          "t.archived = 0",
          "(t.snoozed_until IS NULL OR t.snoozed_until <= ?)",
        ],
        values: [now],
      };
  }
}

export function providerLabelId(view: string | undefined): string | null {
  if (!view?.startsWith("label:")) return null;
  const id = view.slice("label:".length).trim();
  return id || null;
}
