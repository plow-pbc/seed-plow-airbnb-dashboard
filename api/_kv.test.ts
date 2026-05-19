import { describe, it, expect, vi } from 'vitest';
import { makeKv } from './_kv';

describe('makeKv', () => {
  it('GET parses the Upstash {result: "..."} envelope and returns the JSON value', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ result: JSON.stringify({ text: 'hi' }) }), { status: 200 }),
    );
    const kv = makeKv({ url: 'https://kv.example', token: 'tok', fetchFn });
    expect(await kv.get('current_message')).toEqual({ text: 'hi' });
  });

  it('GET returns null when the key is missing', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ result: null }), { status: 200 }));
    const kv = makeKv({ url: 'https://kv.example', token: 'tok', fetchFn });
    expect(await kv.get('current_message')).toBeNull();
  });

  it('GET throws on non-2xx', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response('upstream gone', { status: 502 }));
    const kv = makeKv({ url: 'https://kv.example', token: 'tok', fetchFn });
    await expect(kv.get('current_message')).rejects.toThrow(/502/);
  });

  it('SET posts the JSON-stringified value with the bearer token', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ result: 'OK' }), { status: 200 }));
    const kv = makeKv({ url: 'https://kv.example', token: 'tok', fetchFn });
    await kv.set('current_message', { text: 'hi' });
    const call = fetchFn.mock.calls[0];
    expect(call[0]).toBe('https://kv.example/set/current_message');
    expect(call[1].method).toBe('POST');
    expect((call[1].headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(call[1].body).toBe(JSON.stringify({ text: 'hi' }));
  });
});
