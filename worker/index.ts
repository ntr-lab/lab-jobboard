// Cloudflare Worker: serves the built front end, plus /api/health and /api/contact.

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  CONTACTS: { put(key: string, value: string): Promise<void> };
  CONTACT_SIGNING_KEY?: string;
  APP_VERSION: string;
  SUPABASE_URL: string;
}

const encoder = new TextEncoder();

async function sign(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        version: env.APP_VERSION,
        supabaseUrl: env.SUPABASE_URL,
        secretConfigured: Boolean(env.CONTACT_SIGNING_KEY),
      });
    }

    if (url.pathname === "/api/contact" && request.method === "POST") {
      if (!env.CONTACT_SIGNING_KEY) return Response.json({ error: "not configured" }, { status: 500 });
      const body = await request.json().catch(() => null) as { name?: unknown; message?: unknown } | null;
      const name = typeof body?.name === "string" ? body.name.slice(0, 100) : "";
      const message = typeof body?.message === "string" ? body.message.slice(0, 2000) : "";
      if (!name || !message) return Response.json({ error: "name and message are required" }, { status: 400 });

      const id = crypto.randomUUID();
      const at = new Date().toISOString();
      const signature = await sign(env.CONTACT_SIGNING_KEY, `${id}:${at}:${name}:${message}`);
      await env.CONTACTS.put(`contact:${at}:${id}`, JSON.stringify({ id, at, name, message, signature }));
      return Response.json({ id }, { status: 201 });
    }

    if (url.pathname.startsWith("/api/")) return Response.json({ error: "not found" }, { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
