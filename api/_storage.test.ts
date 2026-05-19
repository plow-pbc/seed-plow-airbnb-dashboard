import { describe, it, expect, vi } from 'vitest';
import { getCurrentMessage, setCurrentMessage } from './_storage';

describe('storage', () => {
  it('getCurrentMessage parses the Upstash envelope and hits current_message with bearer auth', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ result: JSON.stringify({ text: 'hi', expires_at: null }) })),
    );
    expect(await getCurrentMessage({ url: 'https://kv', token: 't', fetchFn })).toEqual({
      text: 'hi',
      expires_at: null,
    });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://kv/get/current_message');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t');
  });

  it('getCurrentMessage returns null when the key is missing', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ result: null })));
    expect(await getCurrentMessage({ url: 'https://kv', token: 't', fetchFn })).toBeNull();
  });

  it('getCurrentMessage throws on non-2xx', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response('upstream gone', { status: 502 }));
    await expect(
      getCurrentMessage({ url: 'https://kv', token: 't', fetchFn }),
    ).rejects.toThrow(/502/);
  });

  it('setCurrentMessage throws on non-2xx', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response('upstream gone', { status: 502 }));
    await expect(
      setCurrentMessage(
        { url: 'https://kv', token: 't', fetchFn },
        { text: 'hi', expires_at: null },
      ),
    ).rejects.toThrow(/502/);
  });

  it('setCurrentMessage posts JSON-stringified message to the current_message key', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: 'OK' })));
    await setCurrentMessage(
      { url: 'https://kv', token: 't', fetchFn },
      { text: 'hi', expires_at: null },
    );
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://kv/set/current_message');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t');
    expect(init.body).toBe(JSON.stringify({ text: 'hi', expires_at: null }));
  });
});
