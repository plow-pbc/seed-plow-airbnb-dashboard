import { describe, it, expect } from 'vitest';
import type { Message } from '../src/message';
import { createMessageHandler, type MessageStore } from './message';

function fakeStore(initial: Message | null = null) {
  let value: Message | null = initial;
  const store: MessageStore & { _peek: () => Message | null } = {
    get: async () => value,
    set: async (m) => {
      value = m;
    },
    _peek: () => value,
  };
  return store;
}

const handler = (store: MessageStore, token = 'secret') =>
  createMessageHandler({ store, token });

describe('createMessageHandler', () => {
  it('GET returns null when no message is set', async () => {
    const res = await handler(fakeStore())(
      new Request('https://x/api/message', { headers: { Authorization: 'Bearer secret' } }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: null });
  });

  it('GET returns the stored message', async () => {
    const msg: Message = { text: 'hi', expires_at: null };
    const res = await handler(fakeStore(msg))(
      new Request('https://x/api/message', { headers: { Authorization: 'Bearer secret' } }),
    );
    expect(await res.json()).toEqual({ message: msg });
  });

  it('rejects requests with the wrong bearer token', async () => {
    const res = await handler(fakeStore())(
      new Request('https://x/api/message', { headers: { Authorization: 'Bearer nope' } }),
    );
    expect(res.status).toBe(401);
  });

  it('rejects requests with no Authorization header', async () => {
    const res = await handler(fakeStore())(new Request('https://x/api/message'));
    expect(res.status).toBe(401);
  });

  it('POST writes a message and returns it', async () => {
    const store = fakeStore();
    const res = await handler(store)(
      new Request('https://x/api/message', {
        method: 'POST',
        headers: { Authorization: 'Bearer secret', 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'You are loved.', expires_at: '2026-05-18T23:59:59Z' }),
      }),
    );
    expect(res.status).toBe(200);
    expect(store._peek()).toEqual({ text: 'You are loved.', expires_at: '2026-05-18T23:59:59Z' });
  });

  it('POST trims text', async () => {
    const store = fakeStore();
    await handler(store)(
      new Request('https://x/api/message', {
        method: 'POST',
        headers: { Authorization: 'Bearer secret', 'content-type': 'application/json' },
        body: JSON.stringify({ text: '  hi there  ' }),
      }),
    );
    expect(store._peek()?.text).toBe('hi there');
  });

  it('POST accepts null expires_at (no expiry)', async () => {
    const store = fakeStore();
    const res = await handler(store)(
      new Request('https://x/api/message', {
        method: 'POST',
        headers: { Authorization: 'Bearer secret', 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'hi', expires_at: null }),
      }),
    );
    expect(res.status).toBe(200);
    expect(store._peek()?.expires_at).toBeNull();
  });

  it('POST rejects an empty text', async () => {
    const res = await handler(fakeStore())(
      new Request('https://x/api/message', {
        method: 'POST',
        headers: { Authorization: 'Bearer secret', 'content-type': 'application/json' },
        body: JSON.stringify({ text: '' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('POST rejects whitespace-only text', async () => {
    const res = await handler(fakeStore())(
      new Request('https://x/api/message', {
        method: 'POST',
        headers: { Authorization: 'Bearer secret', 'content-type': 'application/json' },
        body: JSON.stringify({ text: '   \n\t  ' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('POST rejects a non-ISO expires_at', async () => {
    const res = await handler(fakeStore())(
      new Request('https://x/api/message', {
        method: 'POST',
        headers: { Authorization: 'Bearer secret', 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'ok', expires_at: 'tomorrow' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('POST rejects expires_at without a timezone offset', async () => {
    const res = await handler(fakeStore())(
      new Request('https://x/api/message', {
        method: 'POST',
        headers: { Authorization: 'Bearer secret', 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'ok', expires_at: '2026-05-18T23:59:59' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('POST accepts expires_at with explicit Z offset', async () => {
    const res = await handler(fakeStore())(
      new Request('https://x/api/message', {
        method: 'POST',
        headers: { Authorization: 'Bearer secret', 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'ok', expires_at: '2026-05-18T23:59:59Z' }),
      }),
    );
    expect(res.status).toBe(200);
  });

  it('POST accepts expires_at with explicit ±HH:MM offset', async () => {
    const res = await handler(fakeStore())(
      new Request('https://x/api/message', {
        method: 'POST',
        headers: { Authorization: 'Bearer secret', 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'ok', expires_at: '2026-05-18T23:59:59-07:00' }),
      }),
    );
    expect(res.status).toBe(200);
  });

  it('rejects an unsupported method with 405', async () => {
    const res = await handler(fakeStore())(
      new Request('https://x/api/message', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer secret' },
      }),
    );
    expect(res.status).toBe(405);
  });
});
