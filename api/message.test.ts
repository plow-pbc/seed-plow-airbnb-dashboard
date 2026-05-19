import { describe, it, expect } from 'vitest';
import { createMessageHandler } from './message';

// Key-strict fake: the handler is expected to use 'current_message' for both
// GET and SET. Mismatches throw so a KEY rename can't silently pass.
const EXPECTED_KEY = 'current_message';

function fakeKv(initial: unknown = null) {
  let value: unknown = initial;
  const requireKey = (key: string) => {
    if (key !== EXPECTED_KEY) {
      throw new Error(`fakeKv called with key=${key}, expected ${EXPECTED_KEY}`);
    }
  };
  return {
    get: async <T>(key: string) => {
      requireKey(key);
      return value as T | null;
    },
    set: async <T>(key: string, v: T) => {
      requireKey(key);
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
    const msg = { text: 'hi', expires_at: null };
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
    const stored = kv._peek() as { text: string; expires_at: string };
    expect(stored.text).toBe('You are loved.');
    expect(stored.expires_at).toBe('2026-05-18T23:59:59Z');
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

  it('POST rejects expires_at without a timezone offset', async () => {
    const res = await handler(fakeKv())(
      new Request('https://x/api/message', {
        method: 'POST',
        headers: { Authorization: 'Bearer secret', 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'ok', expires_at: '2026-05-18T23:59:59' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('POST accepts expires_at with explicit Z offset', async () => {
    const kv = fakeKv();
    const res = await handler(kv)(
      new Request('https://x/api/message', {
        method: 'POST',
        headers: { Authorization: 'Bearer secret', 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'ok', expires_at: '2026-05-18T23:59:59Z' }),
      }),
    );
    expect(res.status).toBe(200);
  });

  it('POST accepts expires_at with explicit ±HH:MM offset', async () => {
    const kv = fakeKv();
    const res = await handler(kv)(
      new Request('https://x/api/message', {
        method: 'POST',
        headers: { Authorization: 'Bearer secret', 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'ok', expires_at: '2026-05-18T23:59:59-07:00' }),
      }),
    );
    expect(res.status).toBe(200);
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
