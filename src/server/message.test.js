import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeMessageFetcher } from './message.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('makeMessageFetcher', () => {
  it('GETs the configured URL with the bearer token and returns the body text', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('{"message":null}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const fetcher = makeMessageFetcher({ apiUrl: 'https://api.example/message', token: 'tok' });
    const body = await fetcher();

    expect(body).toBe('{"message":null}');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.example/message');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('passes an AbortSignal so the request can time out', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('ok'));
    vi.stubGlobal('fetch', fetchSpy);

    const fetcher = makeMessageFetcher({ apiUrl: 'https://x', token: 't' });
    await fetcher();

    expect(fetchSpy.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('throws on non-2xx', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('nope', { status: 500 }));
    vi.stubGlobal('fetch', fetchSpy);

    const fetcher = makeMessageFetcher({ apiUrl: 'https://x', token: 't' });
    await expect(fetcher()).rejects.toThrow(/500/);
  });
});
