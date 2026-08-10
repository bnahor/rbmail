export type RecipientCandidate = {
  name: string;
  address: string;
  lastMessageAt: string;
};

export type RecipientSuggestion = {
  name: string;
  address: string;
};

export function rankRecipientSuggestions(
  candidates: RecipientCandidate[],
  ownAddresses: Iterable<string>,
  query = "",
  limit = 50,
): RecipientSuggestion[] {
  const own = new Set(Array.from(ownAddresses, (value) => value.trim().toLowerCase()));
  const term = query.trim().toLowerCase();
  const ranked = new Map<
    string,
    RecipientSuggestion & { count: number; lastMessageAt: string; prefixMatch: boolean }
  >();

  for (const candidate of candidates) {
    const address = candidate.address.trim();
    const key = address.toLowerCase();
    if (!key.includes("@") || own.has(key)) continue;

    const name = candidate.name.trim();
    const matches = !term || key.includes(term) || name.toLowerCase().includes(term);
    if (!matches) continue;

    const existing = ranked.get(key);
    const prefixMatch = key.startsWith(term) || name.toLowerCase().startsWith(term);
    if (existing) {
      existing.count += 1;
      existing.prefixMatch ||= prefixMatch;
      if (candidate.lastMessageAt > existing.lastMessageAt) {
        existing.lastMessageAt = candidate.lastMessageAt;
        if (name) existing.name = name;
      }
      continue;
    }

    ranked.set(key, {
      name: name || address,
      address,
      count: 1,
      lastMessageAt: candidate.lastMessageAt,
      prefixMatch,
    });
  }

  return [...ranked.values()]
    .sort((left, right) =>
      Number(right.prefixMatch) - Number(left.prefixMatch)
      || right.count - left.count
      || right.lastMessageAt.localeCompare(left.lastMessageAt)
      || left.address.localeCompare(right.address),
    )
    .slice(0, Math.max(1, Math.min(limit, 100)))
    .map(({ name, address }) => ({ name, address }));
}
