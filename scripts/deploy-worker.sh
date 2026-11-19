#!/bin/sh
# Builds the front end and deploys the Worker to whichever Cloudflare account the token belongs to.
# Needs: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY.
# Optional: APP_VERSION (defaults to the git commit).
set -eu

: "${CLOUDFLARE_API_TOKEN:?}" "${CLOUDFLARE_ACCOUNT_ID:?}" "${VITE_SUPABASE_URL:?}" "${VITE_SUPABASE_PUBLISHABLE_KEY:?}"
APP_VERSION="${APP_VERSION:-$(git rev-parse --short HEAD 2>/dev/null || echo unknown)}"
KV_TITLE="lab-jobboard-contacts"

npx vite build

# The KV namespace id differs per account, so find it, or create it, and write a generated config.
KV_ID=$(npx wrangler kv namespace list 2>/dev/null | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const list = JSON.parse(s.slice(s.indexOf("[")));
    const hit = list.find((n) => n.title === process.argv[1]);
    process.stdout.write(hit ? hit.id : "");
  });' "$KV_TITLE")
if [ -z "$KV_ID" ]; then
  npx wrangler kv namespace create "$KV_TITLE" >/dev/null
  KV_ID=$(npx wrangler kv namespace list 2>/dev/null | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const list = JSON.parse(s.slice(s.indexOf("[")));
      process.stdout.write(list.find((n) => n.title === process.argv[1]).id);
    });' "$KV_TITLE")
fi

cat > wrangler.generated.jsonc <<EOF
{
  "name": "lab-jobboard",
  "main": "worker/index.ts",
  "compatibility_date": "2026-11-01",
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "kv_namespaces": [{ "binding": "CONTACTS", "id": "$KV_ID" }],
  "vars": { "APP_VERSION": "$APP_VERSION", "SUPABASE_URL": "$VITE_SUPABASE_URL" }
}
EOF

npx wrangler deploy --config wrangler.generated.jsonc
