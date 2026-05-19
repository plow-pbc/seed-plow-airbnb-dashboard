import { describe, it, expect, vi } from 'vitest';
import { createApp } from './app.js';

const routeCases = [
  {
    label: '/api/ical',
    fetcherKey: 'fetchUpstream',
    contentType: 'text/calendar',
  },
  {
    label: '/api/message',
    fetcherKey: 'fetchMessage',
    contentType: 'application/json',
  },
];

function appWith(fetcherKey, fetcher, opts = {}) {
  // Both routes always wired so the host-guard, healthz, and lifecycle cases
  // exercise the route under test regardless of which one is parameterized.
  const fetchers = { fetchUpstream: vi.fn(), fetchMessage: vi.fn() };
  return createApp({ ...fetchers, [fetcherKey]: fetcher, ...opts });
}

describe('createApp', () => {
  it('healthz returns 200 ok', async () => {
    const app = appWith('fetchUpstream', vi.fn());
    const res = await app.fetch(new Request('http://localhost/healthz'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  describe.each(routeCases)('$label cache lifecycle', ({ label, fetcherKey, contentType }) => {
    const url = `http://localhost${label}`;

    it('fetches upstream on first call and sets content-type', async () => {
      const fetcher = vi.fn().mockResolvedValue('FRESH');
      const app = appWith(fetcherKey, fetcher);
      const res = await app.fetch(new Request(url));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain(contentType);
      expect(await res.text()).toBe('FRESH');
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('serves cached body within ttl', async () => {
      const fetcher = vi.fn().mockResolvedValue('CACHED');
      let t = 1_000_000;
      const app = appWith(fetcherKey, fetcher, { ttlMs: 60_000, now: () => t });
      await app.fetch(new Request(url));
      t += 30_000;
      const res = await app.fetch(new Request(url));
      expect(await res.text()).toBe('CACHED');
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('refetches after ttl expires', async () => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce('FIRST')
        .mockResolvedValueOnce('SECOND');
      let t = 1_000_000;
      const app = appWith(fetcherKey, fetcher, { ttlMs: 60_000, now: () => t });
      await app.fetch(new Request(url));
      t += 90_000;
      const res = await app.fetch(new Request(url));
      expect(await res.text()).toBe('SECOND');
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('serves stale cache when upstream fails after ttl', async () => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce('GOOD')
        .mockRejectedValueOnce(new Error('network down'));
      let t = 1_000_000;
      const app = appWith(fetcherKey, fetcher, { ttlMs: 60_000, now: () => t });
      await app.fetch(new Request(url));
      t += 90_000;
      const res = await app.fetch(new Request(url));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('GOOD');
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('rejects non-loopback Host header', async () => {
      const fetcher = vi.fn().mockResolvedValue('SECRET');
      const app = appWith(fetcherKey, fetcher);
      const res = await app.fetch(new Request(`http://evil.example${label}`));
      expect(res.status).toBe(403);
      expect(fetcher).not.toHaveBeenCalled();
    });
  });

  // Route-specific miss-behavior (the two routes diverge on what to do when
  // upstream fails AND the cache is empty).
  it('/api/ical returns 502 when upstream fails with no cache', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('network down'));
    const app = appWith('fetchUpstream', fetcher);
    const res = await app.fetch(new Request('http://localhost/api/ical'));
    expect(res.status).toBe(502);
  });

  it('/api/message returns {message:null} envelope when upstream fails with no cache', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('network down'));
    const app = appWith('fetchMessage', fetcher);
    const res = await app.fetch(new Request('http://localhost/api/message'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: null });
  });

  it('/api/message is not registered when fetchMessage is omitted', async () => {
    const app = createApp({ fetchUpstream: vi.fn() });
    const res = await app.fetch(new Request('http://localhost/api/message'));
    expect(res.status).toBe(404);
  });
});
