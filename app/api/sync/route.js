import { createHash } from "crypto";
import { redis } from "../../../lib/redis";

export const dynamic = "force-dynamic";

const MAX_MEMBERS = 200;
const num = (x) => (Number.isFinite(+x) && +x >= 0 ? Math.min(+x, 1e12) : 0);
const bucket = (b = {}) => ({
  input: num(b.input), output: num(b.output), cacheWrite: num(b.cacheWrite), cacheRead: num(b.cacheRead), messages: num(b.messages),
});

// Each install posts its own usage totals. The random `id` never leaves the machine except here:
// only its hash is shown to others, so nobody else can update your row.
export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const id = String(body?.id ?? "");
  if (!/^[a-zA-Z0-9-]{16,64}$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
  const name = String(body?.name ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 24) || "anonymous";
  const handle = createHash("sha256").update(id).digest("hex").slice(0, 10);

  const team = await redis.hgetall("team");
  if (!(handle in team) && Object.keys(team).length >= MAX_MEMBERS) {
    return Response.json({ error: "team is full" }, { status: 429 });
  }
  const u = body?.usage ?? {};
  const row = { name, seen: Date.now(), today: bucket(u.today), week: bucket(u.week), month: bucket(u.month) };
  await redis.hset("team", handle, JSON.stringify(row));
  return Response.json({ you: handle });
}
