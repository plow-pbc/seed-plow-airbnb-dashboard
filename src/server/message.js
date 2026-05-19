export function makeMessageFetcher({ apiUrl, token, timeoutMs = 10_000 }) {
  return async function fetchMessage() {
    const res = await fetch(apiUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Message API returned HTTP ${res.status}`);
    return await res.text();
  };
}
