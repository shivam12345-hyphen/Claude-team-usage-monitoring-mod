import { redis } from "../../../lib/redis";
import { guard } from "../../../lib/auth";

export const dynamic = "force-dynamic";

// Removes one row by its public handle (as shown by /api/team). For clearing out leftover duplicates.
export async function POST(req) {
  try {
    const denied = await guard(req);
    if (denied) return denied;
    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "bad json" }, { status: 400 });
    }
    const handle = String(body?.handle ?? "");
    if (!/^[a-f0-9]{10}$/.test(handle)) return Response.json({ error: "bad handle" }, { status: 400 });
    const removed = await redis.hdel("team", handle);
    return Response.json({ removed });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 503 });
  }
}
