// Seeds the lab job board with deterministic synthetic data: three staff users, customers,
// jobs, quotes and 50 files. Safe to run again: ids are derived from names, writes are upserts.
// Needs: SUPABASE_URL, SUPABASE_SECRET_KEY, SEED_PW_TECH1, SEED_PW_TECH2, SEED_PW_OFFICE.
import { createHash } from "node:crypto";

const URL_ = need("SUPABASE_URL");
const KEY = need("SUPABASE_SECRET_KEY");
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

// A stable UUID from a name, so re-seeding produces the same rows.
function uuidFor(name) {
  const h = createHash("sha256").update(`lab-jobboard:${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// Deterministic file contents between 2 and 20 KB.
function fileBytes(i) {
  const size = 2048 + ((i * 7919) % 18432);
  const out = Buffer.alloc(size);
  let block = createHash("sha256").update(`file:${i}`).digest();
  for (let off = 0; off < size; off += block.length) {
    block.copy(out, off);
    block = createHash("sha256").update(block).digest();
  }
  return out;
}

async function call(method, path, body, extra = {}) {
  const res = await fetch(`${URL_}${path}`, {
    method,
    headers: { ...headers, ...(body && !(body instanceof Buffer) ? { "Content-Type": "application/json" } : {}), ...extra },
    body: body instanceof Buffer ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function ensureUser(email, password, displayName, role) {
  const list = await call("GET", "/auth/v1/admin/users?per_page=1000");
  const existing = list.users.find((u) => u.email === email);
  const user = existing ?? (await call("POST", "/auth/v1/admin/users", {
    email, password, email_confirm: true, user_metadata: { display_name: displayName },
  }));
  await call("POST", "/rest/v1/profiles?on_conflict=user_id",
    { user_id: user.id, display_name: displayName, role },
    { Prefer: "resolution=merge-duplicates,return=minimal" });
  return user.id;
}

const tech1 = await ensureUser("tech1@example.test", need("SEED_PW_TECH1"), "Technician One", "technician");
const tech2 = await ensureUser("tech2@example.test", need("SEED_PW_TECH2"), "Technician Two", "technician");
await ensureUser("office@example.test", need("SEED_PW_OFFICE"), "Office", "office");

const towns = ["Northfield", "Easton", "Westbury", "Southam", "Midton"];
const customers = Array.from({ length: 10 }, (_, i) => ({
  id: uuidFor(`customer:${i}`),
  name: `Customer ${String(i + 1).padStart(2, "0")}`,
  town: towns[i % towns.length],
}));
await call("POST", "/rest/v1/customers?on_conflict=id", customers, { Prefer: "resolution=merge-duplicates,return=minimal" });

const statuses = ["open", "in_progress", "done"];
const tasks = ["Replace tap", "Service boiler", "Fit radiator", "Repair gutter", "Rewire socket", "Fix door lock"];
const jobs = Array.from({ length: 30 }, (_, i) => ({
  id: uuidFor(`job:${i}`),
  customer_id: customers[i % customers.length].id,
  title: `${tasks[i % tasks.length]} #${i + 1}`,
  status: statuses[i % statuses.length],
  assigned_to: i % 2 === 0 ? tech1 : tech2,
}));
await call("POST", "/rest/v1/jobs?on_conflict=id", jobs, { Prefer: "resolution=merge-duplicates,return=minimal" });

const quotes = jobs.map((job, i) => ({ id: uuidFor(`quote:${i}`), job_id: job.id, amount_pence: 5000 + i * 1250 }));
await call("POST", "/rest/v1/quotes?on_conflict=id", quotes, { Prefer: "resolution=merge-duplicates,return=minimal" });

for (let i = 0; i < 50; i++) {
  const path = `${jobs[i % jobs.length].id}/file-${String(i).padStart(2, "0")}.bin`;
  await call("POST", `/storage/v1/object/job-files/${path}`, fileBytes(i),
    { "Content-Type": "application/octet-stream", "x-upsert": "true" });
}

console.log(`seeded: 3 users, ${customers.length} customers, ${jobs.length} jobs, ${quotes.length} quotes, 50 files`);
