export type Message = {
  type: string;
  text: string;
  expires_at: string | null;
};

export function isFresh(message: Message | null, now: Date): boolean {
  if (!message) return false;
  if (message.expires_at === null) return true;
  return new Date(message.expires_at).getTime() > now.getTime();
}

// Walks `messages` (newest first — i.e. list order returned by LRANGE 0 N) and
// returns the first one that matches `filter.type` (when set) AND is fresh.
export function pickLatest(
  messages: Message[],
  filter: { type?: string },
  now: Date,
): Message | null {
  for (const m of messages) {
    if (filter.type !== undefined && m.type !== filter.type) continue;
    if (!isFresh(m, now)) continue;
    return m;
  }
  return null;
}
