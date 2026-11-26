import { redis } from "../../../lib/redis";
import { memberFor } from "../../../lib/team";

export const dynamic = "force-dynamic";

// A member sets the name others see for them. Their usage stays tied to their token.
export async function POST(req) {
  const id = memberFor(req);
  if (!id) return new Response("unauthorized", { status: 401 });
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "send JSON like {\"name\":\"Pranav\"}" }, { status: 400 });
  }
  const name = String(body?.name ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 24);
  if (!name) return Response.json({ error: "name is empty" }, { status: 400 });
  await redis.hset("names", id, name);
  return Response.json({ id, name });
}
