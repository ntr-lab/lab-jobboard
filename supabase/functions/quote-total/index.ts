// Returns a quote's total including VAT, signed with QUOTE_SIGNING_KEY.
// Reads the quote with the caller's own rights, so row-level security decides access.
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const encoder = new TextEncoder();

async function sign(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const signingKey = Deno.env.get("QUOTE_SIGNING_KEY");
  if (!signingKey) {
    return Response.json({ error: "QUOTE_SIGNING_KEY is not set" }, { status: 500, headers: cors });
  }

  const { quote_id } = await req.json().catch(() => ({}));
  if (typeof quote_id !== "string") {
    return Response.json({ error: "quote_id is required" }, { status: 400, headers: cors });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    (Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY"))!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
  );
  const { data: quote, error } = await supabase
    .from("quotes").select("id, amount_pence, vat_rate").eq("id", quote_id).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500, headers: cors });
  if (!quote) return Response.json({ error: "not found" }, { status: 404, headers: cors });

  const total_pence = Math.round(quote.amount_pence * (1 + Number(quote.vat_rate)));
  const signature = await sign(signingKey, `${quote.id}:${total_pence}`);
  return Response.json({ quote_id: quote.id, total_pence, signed: true, signature }, { headers: cors });
});
