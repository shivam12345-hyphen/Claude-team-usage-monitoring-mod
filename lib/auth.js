import { createHash, timingSafeEqual } from "crypto";

const digest = (x) => createHash("sha256").update(String(x)).digest();
const same = (a, b) => timingSafeEqual(digest(a), digest(b));

// The team login: TEAM_USER and TEAM_PASSWORD in the Vercel project. Fails closed when they are not set.
// Returns null when the request may continue, or the Response to send back.
export async function guard(req) {
  const user = process.env.TEAM_USER;
  const pass = process.env.TEAM_PASSWORD;
  if (!user || !pass) {
    return Response.json({ error: "TEAM_USER and TEAM_PASSWORD are not set on the server" }, { status: 503 });
  }
  const ok =
    same(req.headers.get("x-team-user") ?? "", user) & same(req.headers.get("x-team-password") ?? "", pass);
  if (!ok) {
    await new Promise((r) => setTimeout(r, 500)); // slows down password guessing
    return Response.json({ error: "wrong team username or password" }, { status: 401 });
  }
  return null;
}
