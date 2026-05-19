import { describe, it, expect } from 'vitest';
import { createMessageHandler } from './message';

function fakeKv(initial: unknown = null) {
  let value: unknown = initial;
  return {
    get: async <T>() => value as T | null,
    set: async <T>(_key: string, v: T) => {
      value = v;
    },
    _peek: () => value,
  };
}

const handler = (kv: ReturnType<typeof fakeKv>, token = 'secret') =>
  createMessageHandler({ kv, token });

describe('createMessageHandler', () => {
  it('GET returns null when no message is set', async () => {
    const res = await handler(fakeKv())(
      new Request('https://x/api/message', { headers: { Authorization: 'Bearer secret' } }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: null });
  });

  it('GET returns the stored message', async () => {
    const msg = { text: 'hi', posted_at: '2026-05-18T07:00:00Z', expires_at: null };
    const res = await handler(fakeKv(msg))(
      new Request('https://x/api/message', { headers: { Authorization: 'Bearer secret' } }),
    );
    expect(await res.json()).toEqual({ message: msg });
  });

  it('rejects requests with the wrong bearer token', async () => {
    const res = await handler(fakeKv())(
      new Request('https://x/api/message', { headers: { Authorization: 'Bearer nope' } }),
    );
    expect(res.status).toBe(401);
  });

  it('rejects requests with no Authorization header', async () => {
    const res = await handler(fakeKv())(new Request('https://x/api/message'));
    expect(res.status).toBe(401);
  });

  it('POST writes a message and returns it', async () => {
    const kv = fakeKv();
    const body = { text: 'You are loved.', expires_at: '2026-05-18T23:59:59Z' };
    const res = await handler(kv)(
      new Request('https://x/api/message', {
        method: 'POST',
        headers: { Authorization: 'Bearer secret', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    expect(res.status).toBe(200);
    const stored = kv._peek() as { text: string; posted_at: string; expires_at: string };
    expect(stored.text).toBe('You are loved.');
    expect(stored.expires_at).toBe('2026-05-18T23:59:59Z');
    expect(typeof stored.posted_at).toBe('string');
    expect(Number.isNaN(Date.parse(stored.posted_at))).toBe(false);
  });

  it('POST trims text', async () => {
    const kv = fakeKv();
    await handler(kv)(
      new Request('https://x/api/message', {
        method: 'POST',
        headers: { Authorization: 'Bearer secret', 'content-type': 'application/json' },
        body: JSON.stringify({ text: '  hi there  ' }),
      }),
    );
    const stored = kv._peek() as { text: string };
    expect(stored.text).toBe('hi there');
  });

  it('POST accepts null expires_at (no expiry)', async () => {
    const kv = fakeKv();
    const res = await handler(kv)(
      new Request('https://x/api/message', {
        method: 'POST',
        headers: { Authorization: 'Bearer secret', 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'hi', expires_at: null }),
      }),
    );
    expect(res.status).toBe(200);
    const stored = kv._peek() as { expires_at: string | null };
    expect(stored.expires_at).toBeNull();
  });

  it('POST rejects an empty text', async () => {
    const res = await handler(fakeKv())(
      new Request('https://x/api/message', {
        method: 'POST',
        headers: { Authorization: 'Bearer secret', 'content-type': 'application/json' },
        body: JSON.stringify({ text: '' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('POST rejects whitespace-only text', async () => {
    const res = await handler(fakeKv())(
      new Request('https://x/api/message', {
        method: 'POST',
        headers: { Authorization: 'Bearer secret', 'content-type': 'application/json' },
        body: JSON.stringify({ text: '   \n\t  ' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('POST rejects a non-ISO expires_at', async () => {
    const res = await handler(fakeKv())(
      new Request('https://x/api/message', {
        method: 'POST',
        headers: { Authorization: 'Bearer secret', 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'ok', expires_at: 'tomorrow' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects an unsupported method with 405', async () => {
    const res = await handler(fakeKv())(
      new Request('https://x/api/message', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer secret' },
      }),
    );
    expect(res.status).toBe(405);
  });
});
