import type { Message } from '../src/message';

const KEY = 'messages';
export const MAX_MESSAGES = 50;

type FetchFn = typeof fetch;

export type StorageEnv = {
  url: string;
  token: string;
  fetchFn?: FetchFn;
};

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export async function appendMessage(
  { url, token, fetchFn = fetch }: StorageEnv,
  message: Message,
): Promise<void> {
  const push = await fetchFn(`${url}/lpush/${KEY}`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'content-type': 'application/json' },
    body: JSON.stringify(message),
  });
  if (!push.ok) throw new Error(`KV LPUSH failed: ${push.status}`);

  const trim = await fetchFn(`${url}/ltrim/${KEY}/0/${MAX_MESSAGES - 1}`, {
    method: 'POST',
    headers: authHeaders(token),
  });
  if (!trim.ok) throw new Error(`KV LTRIM failed: ${trim.status}`);
}

export async function getRecentMessages({
  url,
  token,
  fetchFn = fetch,
}: StorageEnv): Promise<Message[]> {
  const res = await fetchFn(`${url}/lrange/${KEY}/0/${MAX_MESSAGES - 1}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`KV LRANGE failed: ${res.status}`);
  const body = (await res.json()) as { result: string[] | null };
  return (body.result ?? []).map((s) => JSON.parse(s) as Message);
}
