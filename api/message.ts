import type { Message } from '../src/message';
import { getCurrentMessage, setCurrentMessage, type StorageEnv } from './_storage';

export type MessageStore = {
  get: () => Promise<Message | null>;
  set: (message: Message) => Promise<void>;
};

export function createMessageHandler({
  store,
  token,
}: {
  store: MessageStore;
  token: string;
}) {
  return async (req: Request): Promise<Response> => {
    if (req.headers.get('authorization') !== `Bearer ${token}`) {
      return new Response('unauthorized', { status: 401 });
    }
    if (req.method === 'GET') {
      const message = await store.get();
      return Response.json({ message });
    }
    if (req.method === 'POST') {
      const body = (await req.json().catch(() => null)) as
        | { text?: unknown; expires_at?: unknown }
        | null;
      const text = typeof body?.text === 'string' ? body.text.trim() : '';
      if (!text) return new Response('text required', { status: 400 });
      const rawExpiresAt = body?.expires_at;
      if (rawExpiresAt != null) {
        if (
          typeof rawExpiresAt !== 'string' ||
          Number.isNaN(Date.parse(rawExpiresAt)) ||
          !/(?:Z|[+-]\d{2}:?\d{2})$/.test(rawExpiresAt)
        ) {
          return new Response('expires_at must include a timezone offset (Z or ±HH:MM)', {
            status: 400,
          });
        }
      }
      const message: Message = {
        text,
        expires_at: typeof rawExpiresAt === 'string' ? rawExpiresAt : null,
      };
      await store.set(message);
      return Response.json({ message });
    }
    return new Response('method not allowed', { status: 405 });
  };
}

export default async function handler(req: Request): Promise<Response> {
  const token = process.env.DASHBOARD_TOKEN;
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!token || !kvUrl || !kvToken) {
    return new Response('server misconfigured', { status: 500 });
  }
  const env: StorageEnv = { url: kvUrl, token: kvToken };
  const store: MessageStore = {
    get: () => getCurrentMessage(env),
    set: (message) => setCurrentMessage(env, message),
  };
  return createMessageHandler({ store, token })(req);
}

export const config = { runtime: 'edge' };
