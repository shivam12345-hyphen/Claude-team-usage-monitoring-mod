import { createHash } from "crypto";
import { redis } from "../../../lib/redis";
import { guard } from "../../../lib/auth";

export const dynamic = "force-dynamic";

const MAX_MEMBERS = 200;
const num = (x) => (Number.isFinite(+x) && +x >= 0 ? Math.min(+x, 1e12) : 0);
const bucket = (b = {}) => ({
  input: num(b.input), output: num(b.output), cacheWrite: num(b.cacheWrite), cacheRead: num(b.cacheRead), messages: num(b.messages),
});

// Each install posts its own usage totals. The random `id` never leaves the machine except here:
// only its hash is shown to others, so nobody else can update your row.
export async function POST(req) {
  try {
    const denied = await guard(req);
    if (denied) return denied;
    return await handle(req);
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 503 });
  }
}

async function handle(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const id = String(body?.id ?? "");
  if (!/^[a-zA-Z0-9-]{16,64}$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
  const name = String(body?.name ?? "").replace(/[^\p{L}\p{N} ._'-]/gu, "").trim().slice(0, 24) || "anonymous";
  const handle = createHash("sha256").update(id).digest("hex").slice(0, 10);

  const team = await redis.hgetall("team");
  if (!(handle in team) && Object.keys(team).length >= MAX_MEMBERS) {
    return Response.json({ error: "team is full" }, { status: 429 });
  }
  const u = body?.usage ?? {};
  // One row per install id. Rows are never merged or removed because of names or computers:
  // several people can share a Mac account name, and none of them may hide another.
  const row = { name, seen: Date.now(), today: bucket(u.today), week: bucket(u.week), month: bucket(u.month) };
  await redis.hset("team", handle, JSON.stringify(row));
  // An install that switched to a new id says which old ids were its own. Only someone who knows an old id can name it,
  // so this can only remove the caller's own earlier row.
  for (const old of Array.isArray(body?.replaces) ? body.replaces.slice(0, 3) : []) {
    if (!/^[a-zA-Z0-9-]{16,64}$/.test(String(old))) continue;
    const oldHandle = createHash("sha256").update(String(old)).digest("hex").slice(0, 10);
    if (oldHandle !== handle && oldHandle in team) await redis.hdel("team", oldHandle);
  }
  return Response.json({ you: handle });
}
