import { redis } from "../../../lib/redis";

export const dynamic = "force-dynamic";

const STALE_MS = 35 * 864e5;

// Everyone who has the mod installed, with their usage totals.
export async function GET() {
  try {
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
      if (now - m.seen < STALE_MS) members.push({ handle, ...m });
    } catch {}
  }
  return Response.json({ updated: now, members });
}
