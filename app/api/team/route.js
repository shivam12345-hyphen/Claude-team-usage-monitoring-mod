import { redis } from "../../../lib/redis";
import { guard } from "../../../lib/auth";

export const dynamic = "force-dynamic";

const STALE_MS = 14 * 864e5; // rows that have not synced for two weeks are dropped

// Everyone who has the mod installed, with their usage totals.
export async function GET(req) {
  try {
    const denied = await guard(req);
    if (denied) return denied;
    return await handle();
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 503 });
  }
}

async function handle() {
  const team = await redis.hgetall("team");
  const now = Date.now();
  const members = [];
  for (const [handle, raw] of Object.entries(team)) {
    try {
      const m = JSON.parse(raw);
      if (now - m.seen >= STALE_MS) {
        await redis.hdel("team", handle);
        continue;
      }
      members.push({ handle, name: String(m.name ?? "").replace(/[^\p{L}\p{N} ._'-]/gu, "").trim().slice(0, 24) || "anonymous", seen: m.seen, today: m.today, week: m.week, month: m.month });
    } catch {}
  }
  return Response.json({ updated: now, members });
}
