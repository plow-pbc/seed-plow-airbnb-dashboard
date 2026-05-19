export type Message = {
  text: string;
  expires_at: string | null;
};

export function isFresh(message: Message | null, now: Date): boolean {
  if (!message || !message.text.trim()) return false;
  if (message.expires_at === null) return true;
  return new Date(message.expires_at).getTime() > now.getTime();
}
