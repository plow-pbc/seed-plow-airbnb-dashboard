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

  it('/api/message is not registered when fetchMessage is omitted', async () => {
    const app = makeApp({ fetchUpstream: vi.fn() });
    const res = await app.fetch(new Request('http://localhost/api/message'));
    expect(res.status).toBe(404);
  });

  it('/api/message fetches upstream on first call and returns application/json', async () => {
    const fetchMessage = vi.fn().mockResolvedValue('{"message":{"text":"hi"}}');
    const app = createApp({ fetchUpstream: vi.fn(), fetchMessage });

    const res = await app.fetch(new Request('http://localhost/api/message'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.text()).toBe('{"message":{"text":"hi"}}');
    expect(fetchMessage).toHaveBeenCalledTimes(1);
  });

  it('/api/message returns cached body within ttl', async () => {
    const fetchMessage = vi.fn().mockResolvedValue('CACHED');
    let t = 1_000_000;
    const app = createApp({
      fetchUpstream: vi.fn(),
      fetchMessage,
      ttlMs: 60_000,
      now: () => t,
    });

    await app.fetch(new Request('http://localhost/api/message'));
    t += 30_000;
    const res = await app.fetch(new Request('http://localhost/api/message'));

    expect(await res.text()).toBe('CACHED');
    expect(fetchMessage).toHaveBeenCalledTimes(1);
  });

  it('/api/message serves stale cache when upstream fails after ttl', async () => {
    const fetchMessage = vi
      .fn()
      .mockResolvedValueOnce('{"message":{"text":"first"}}')
      .mockRejectedValueOnce(new Error('network down'));
    let t = 1_000_000;
    const app = createApp({
      fetchUpstream: vi.fn(),
      fetchMessage,
      ttlMs: 60_000,
      now: () => t,
    });

    await app.fetch(new Request('http://localhost/api/message'));
    t += 90_000;
    const res = await app.fetch(new Request('http://localhost/api/message'));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"message":{"text":"first"}}');
    expect(fetchMessage).toHaveBeenCalledTimes(2);
  });

  it('/api/message returns {message:null} envelope when upstream fails with no cache', async () => {
    const fetchMessage = vi.fn().mockRejectedValue(new Error('network down'));
    const app = createApp({ fetchUpstream: vi.fn(), fetchMessage });

    const res = await app.fetch(new Request('http://localhost/api/message'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: null });
  });

  it('/api/message rejects requests with a non-loopback Host header', async () => {
    const fetchMessage = vi.fn();
    const app = createApp({ fetchUpstream: vi.fn(), fetchMessage });

    const res = await app.fetch(new Request('http://evil.example/api/message'));
    expect(res.status).toBe(403);
    expect(fetchMessage).not.toHaveBeenCalled();
  });
});
