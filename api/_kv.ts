type FetchFn = typeof fetch;

export function makeKv({
  url,
  token,
  fetchFn = fetch,
}: {
  url: string;
  token: string;
  fetchFn?: FetchFn;
}) {
  const auth = { Authorization: `Bearer ${token}` };
  return {
    async get<T>(key: string): Promise<T | null> {
      const res = await fetchFn(`${url}/get/${encodeURIComponent(key)}`, { headers: auth });
      if (!res.ok) throw new Error(`KV GET failed: ${res.status}`);
      const body = (await res.json()) as { result: string | null };
      return body.result === null ? null : (JSON.parse(body.result) as T);
    },
    async set<T>(key: string, value: T): Promise<void> {
      const res = await fetchFn(`${url}/set/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify(value),
      });
      if (!res.ok) throw new Error(`KV SET failed: ${res.status}`);
    },
  };
}

export type Kv = ReturnType<typeof makeKv>;
