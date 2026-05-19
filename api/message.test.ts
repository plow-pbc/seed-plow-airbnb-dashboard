import { describe, it, expect } from 'vitest';
import type { Message } from '../src/message';
import { msg } from '../src/message.fixtures';
import { createMessageHandler, type MessageStore } from './message';

const TOKEN = 'secret';
const URL_BASE = 'https://x/api/message';
const NOW = new Date('2026-05-19T12:00:00Z');

function fakeStore(initial: Message[] = []) {
  const list: Message[] = [...initial];
  const store: MessageStore & { _peek: () => Message[] } = {
    list: async () => list.slice(),
    append: async (m) => {
      list.unshift(m);
    },
    _peek: () => list.slice(),
  };
  return store;
}

function handlerFor(store: MessageStore) {
  return createMessageHandler({ store, token: TOKEN, now: () => NOW });
}

function get(store: MessageStore, qs = '', bearer = TOKEN) {
  return handlerFor(store)(
    new Request(`${URL_BASE}${qs}`, { headers: { Authorization: `Bearer ${bearer}` } }),
  );
}

function post(store: MessageStore, body: unknown, bearer = TOKEN) {
  return handlerFor(store)(
    new Request(URL_BASE, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

describe('createMessageHandler — auth', () => {
  it('rejects bad bearer', async () => {
    const res = await get(fakeStore(), '', 'nope');
    expect(res.status).toBe(401);
  });

  it('rejects missing Authorization header', async () => {
    const res = await handlerFor(fakeStore())(new Request(URL_BASE));
    expect(res.status).toBe(401);
  });

  it('405 on unsupported method', async () => {
    const res = await handlerFor(fakeStore())(
      new Request(URL_BASE, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${TOKEN}` },
      }),
    );
    expect(res.status).toBe(405);
  });
});

describe('createMessageHandler — GET', () => {
  it('returns null when there are no messages', async () => {
    const res = await get(fakeStore());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: null });
  });

  it('returns the latest fresh message (no filter)', async () => {
    const newest = msg({ text: 'new' });
    const older = msg({ text: 'old' });
    const res = await get(fakeStore([newest, older]));
    expect(await res.json()).toEqual({ message: newest });
  });

  it('filters by ?type=', async () => {
    const alert = msg({ type: 'alert', text: 'a' });
    const affirmation = msg({ type: 'affirmation', text: 'b' });
    const res = await get(fakeStore([alert, affirmation]), '?type=affirmation');
    expect(await res.json()).toEqual({ message: affirmation });
  });

  it('treats ?type= (empty value) the same as no filter', async () => {
    const alert = msg({ type: 'alert', text: 'a' });
    const affirmation = msg({ type: 'affirmation', text: 'b' });
    const res = await get(fakeStore([alert, affirmation]), '?type=');
    expect(await res.json()).toEqual({ message: alert });
  });

  it('returns null when ?type= matches nothing', async () => {
    const alert = msg({ type: 'alert' });
    const res = await get(fakeStore([alert]), '?type=affirmation');
    expect(await res.json()).toEqual({ message: null });
  });

  it('skips expired messages', async () => {
    const expired = msg({ text: 'gone', expires_at: '2026-05-19T11:00:00Z' });
    const fresh = msg({ text: 'still here' });
    const res = await get(fakeStore([expired, fresh]));
    expect(await res.json()).toEqual({ message: fresh });
  });
});

describe('createMessageHandler — POST', () => {
  it('appends a message and echoes the stored record', async () => {
    const store = fakeStore();
    const res = await post(store, {
      type: 'affirmation',
      text: 'You are loved.',
      expires_at: '2026-05-19T23:59:59Z',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { message: Message };
    expect(body.message).toEqual({
      type: 'affirmation',
      text: 'You are loved.',
      expires_at: '2026-05-19T23:59:59Z',
    });
    expect(store._peek()).toEqual([body.message]);
  });

  it('accepts null expires_at (no expiry)', async () => {
    const store = fakeStore();
    const res = await post(store, { type: 'affirmation', text: 'hi', expires_at: null });
    expect(res.status).toBe(200);
    expect(store._peek()[0].expires_at).toBeNull();
  });

  it('trims text', async () => {
    const store = fakeStore();
    await post(store, { type: 'affirmation', text: '  hi there  ' });
    expect(store._peek()[0].text).toBe('hi there');
  });

  it('trims type', async () => {
    const store = fakeStore();
    await post(store, { type: '  affirmation  ', text: 'hi' });
    expect(store._peek()[0].type).toBe('affirmation');
  });

  it('400 when type is missing', async () => {
    const res = await post(fakeStore(), { text: 'hi' });
    expect(res.status).toBe(400);
  });

  it('400 when type is empty / whitespace', async () => {
    const res = await post(fakeStore(), { type: '   ', text: 'hi' });
    expect(res.status).toBe(400);
  });

  it('400 when text is empty / whitespace', async () => {
    const res = await post(fakeStore(), { type: 'affirmation', text: '  ' });
    expect(res.status).toBe(400);
  });

  it('400 on a non-ISO expires_at', async () => {
    const res = await post(fakeStore(), {
      type: 'affirmation',
      text: 'ok',
      expires_at: 'tomorrow',
    });
    expect(res.status).toBe(400);
  });

  it('400 on expires_at without a timezone offset', async () => {
    const res = await post(fakeStore(), {
      type: 'affirmation',
      text: 'ok',
      expires_at: '2026-05-18T23:59:59',
    });
    expect(res.status).toBe(400);
  });

  it('accepts expires_at with Z offset', async () => {
    const res = await post(fakeStore(), {
      type: 'affirmation',
      text: 'ok',
      expires_at: '2026-05-18T23:59:59Z',
    });
    expect(res.status).toBe(200);
  });

  it('accepts expires_at with ±HH:MM offset', async () => {
    const res = await post(fakeStore(), {
      type: 'affirmation',
      text: 'ok',
      expires_at: '2026-05-18T23:59:59-07:00',
    });
    expect(res.status).toBe(200);
  });
});
