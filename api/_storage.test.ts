import { describe, it, expect, vi } from 'vitest';
import { appendMessage, getRecentMessages, MAX_MESSAGES } from './_storage';
import type { Message } from '../src/message';

const ENV = { url: 'https://kv', token: 't' };

function msg(overrides: Partial<Message> = {}): Message {
  return {
    type: 'affirmation',
    text: 'hi',
    expires_at: null,
    ...overrides,
  };
}

describe('appendMessage', () => {
  it('LPUSHes the JSON-stringified message and trims to MAX_MESSAGES', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: 1 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: 'OK' })));

    const m = msg({ text: 'hello' });
    await appendMessage({ ...ENV, fetchFn }, m);

    expect(fetchFn).toHaveBeenCalledTimes(2);

    const [lpushUrl, lpushInit] = fetchFn.mock.calls[0];
    expect(lpushUrl).toBe('https://kv/lpush/messages');
    expect(lpushInit.method).toBe('POST');
    expect((lpushInit.headers as Record<string, string>).Authorization).toBe('Bearer t');
    expect(lpushInit.body).toBe(JSON.stringify(m));

    const [ltrimUrl, ltrimInit] = fetchFn.mock.calls[1];
    expect(ltrimUrl).toBe(`https://kv/ltrim/messages/0/${MAX_MESSAGES - 1}`);
    expect(ltrimInit.method).toBe('POST');
    expect((ltrimInit.headers as Record<string, string>).Authorization).toBe('Bearer t');
  });

  it('throws on non-2xx from LPUSH', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response('boom', { status: 502 }));
    await expect(appendMessage({ ...ENV, fetchFn }, msg())).rejects.toThrow(/502/);
  });

  it('throws on non-2xx from LTRIM', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: 1 })))
      .mockResolvedValueOnce(new Response('boom', { status: 502 }));
    await expect(appendMessage({ ...ENV, fetchFn }, msg())).rejects.toThrow(/502/);
  });
});

describe('getRecentMessages', () => {
  it('LRANGEs and parses each entry, newest first', async () => {
    const a = msg({ text: 'newest' });
    const b = msg({ text: 'older' });
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ result: [JSON.stringify(a), JSON.stringify(b)] })),
    );

    const out = await getRecentMessages({ ...ENV, fetchFn });

    expect(out).toEqual([a, b]);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`https://kv/lrange/messages/0/${MAX_MESSAGES - 1}`);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t');
  });

  it('returns an empty array when the list is empty / key missing', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: [] })));
    expect(await getRecentMessages({ ...ENV, fetchFn })).toEqual([]);
  });

  it('returns an empty array when Upstash returns result: null (key never existed)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: null })));
    expect(await getRecentMessages({ ...ENV, fetchFn })).toEqual([]);
  });

  it('throws on non-2xx', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('boom', { status: 502 }));
    await expect(getRecentMessages({ ...ENV, fetchFn })).rejects.toThrow(/502/);
  });
});
