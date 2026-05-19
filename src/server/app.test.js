import { describe, it, expect, vi } from 'vitest';
import { createApp } from './app.js';

function makeApp({ fetchUpstream, ttlMs = 60_000, nowFn = () => 1_000_000 } = {}) {
  return createApp({ fetchUpstream, ttlMs, now: nowFn });
}

describe('createApp', () => {
  it('healthz returns 200 ok', async () => {
    const app = makeApp({ fetchUpstream: vi.fn() });
    const res = await app.fetch(new Request('http://localhost/healthz'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('/api/ical fetches upstream on first call and returns text/calendar', async () => {
    const fetchUpstream = vi.fn().mockResolvedValue('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
    const app = makeApp({ fetchUpstream });

    const res = await app.fetch(new Request('http://localhost/api/ical'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/calendar');
    expect(await res.text()).toContain('VCALENDAR');
    expect(fetchUpstream).toHaveBeenCalledTimes(1);
  });

  it('/api/ical returns cached body for a second call within ttl', async () => {
    const fetchUpstream = vi.fn().mockResolvedValue('CACHED');
    let t = 1_000_000;
    const app = makeApp({ fetchUpstream, ttlMs: 60_000, nowFn: () => t });

    await app.fetch(new Request('http://localhost/api/ical'));
    t += 30_000; // 30s later — within TTL
    const res = await app.fetch(new Request('http://localhost/api/ical'));

    expect(await res.text()).toBe('CACHED');
    expect(fetchUpstream).toHaveBeenCalledTimes(1);
  });

  it('/api/ical re-fetches after ttl expires', async () => {
    const fetchUpstream = vi
      .fn()
      .mockResolvedValueOnce('FIRST')
      .mockResolvedValueOnce('SECOND');
    let t = 1_000_000;
    const app = makeApp({ fetchUpstream, ttlMs: 60_000, nowFn: () => t });

    await app.fetch(new Request('http://localhost/api/ical'));
    t += 90_000; // past TTL
    const res = await app.fetch(new Request('http://localhost/api/ical'));

    expect(await res.text()).toBe('SECOND');
    expect(fetchUpstream).toHaveBeenCalledTimes(2);
  });

  it('/api/ical serves stale cache when upstream fails after ttl', async () => {
    const fetchUpstream = vi
      .fn()
      .mockResolvedValueOnce('GOOD')
      .mockRejectedValueOnce(new Error('network down'));
    let t = 1_000_000;
    const app = makeApp({ fetchUpstream, ttlMs: 60_000, nowFn: () => t });

    await app.fetch(new Request('http://localhost/api/ical'));
    t += 90_000;
    const res = await app.fetch(new Request('http://localhost/api/ical'));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('GOOD');
    expect(fetchUpstream).toHaveBeenCalledTimes(2);
  });

  it('/api/ical returns 502 when upstream fails with no cache', async () => {
    const fetchUpstream = vi.fn().mockRejectedValue(new Error('network down'));
    const app = makeApp({ fetchUpstream });

    const res = await app.fetch(new Request('http://localhost/api/ical'));
    expect(res.status).toBe(502);
  });

  it('/api/* rejects requests with a non-loopback Host header (DNS-rebinding guard)', async () => {
    const fetchUpstream = vi.fn().mockResolvedValue('SECRET');
    const app = makeApp({ fetchUpstream });

    const res = await app.fetch(new Request('http://evil.example/api/ical'));
    expect(res.status).toBe(403);
    expect(fetchUpstream).not.toHaveBeenCalled();
  });
});
