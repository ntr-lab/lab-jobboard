# Lab job board

A dummy app for the cloud-native recovery sprint: a job board for a small trades firm, on Supabase, a Cloudflare Worker and GitHub. **Synthetic data only.** It exists to be attacked and rebuilt.

- `supabase/migrations/`: tables, row-level security, a trigger, functions, `pg_trgm`, a `pg_cron` heartbeat, a private bucket and Realtime
- `supabase/functions/quote-total/`: an Edge Function with a secret
- `worker/` and `src/`: the Worker (`/api/health`, `/api/contact` with a secret and KV) and the React front end
- `scripts/seed.mjs`: deterministic seed data; `scripts/deploy-worker.sh`: build and deploy to the account the token belongs to
