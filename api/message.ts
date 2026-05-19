import { makeKv, type Kv } from './_kv';

const KEY = 'current_message';

type Message = {
  text: string;
  posted_at: string;
  expires_at: string | null;
};

export function createMessageHandler({ kv, token }: { kv: Kv; token: string }) {
  return async (req: Request): Promise<Response> => {
    if (req.headers.get('authorization') !== `Bearer ${token}`) {
      return new Response('unauthorized', { status: 401 });
    }
    if (req.method === 'GET') {
      const message = await kv.get<Message>(KEY);
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
        if (typeof rawExpiresAt !== 'string' || Number.isNaN(Date.parse(rawExpiresAt))) {
          return new Response('expires_at must be an ISO string or null', { status: 400 });
        }
      }
      const message: Message = {
        text,
        posted_at: new Date().toISOString(),
        expires_at: typeof rawExpiresAt === 'string' ? rawExpiresAt : null,
      };
      await kv.set(KEY, message);
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
  const kv = makeKv({ url: kvUrl, token: kvToken });
  return createMessageHandler({ kv, token })(req);
}

export const config = { runtime: 'edge' };
