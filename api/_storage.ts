import type { Message } from '../src/message';

const KEY = 'current_message';

type FetchFn = typeof fetch;

export type StorageEnv = {
  url: string;
  token: string;
  fetchFn?: FetchFn;
};

export async function getCurrentMessage({
  url,
  token,
  fetchFn = fetch,
}: StorageEnv): Promise<Message | null> {
  const res = await fetchFn(`${url}/get/${KEY}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`KV GET failed: ${res.status}`);
  const body = (await res.json()) as { result: string | null };
  return body.result === null ? null : (JSON.parse(body.result) as Message);
}

export async function setCurrentMessage(
  { url, token, fetchFn = fetch }: StorageEnv,
  message: Message,
): Promise<void> {
  const res = await fetchFn(`${url}/set/${KEY}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(message),
  });
  if (!res.ok) throw new Error(`KV SET failed: ${res.status}`);
}
