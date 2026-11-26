import { redis } from "../../../lib/redis";

export const dynamic = "force-dynamic";

// Team usage as JSON for the Claude mod. A personal token from INGEST_TOKENS may read it.
export async function GET(req) {
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  const tokenUsers = Object.fromEntries(
    (process.env.INGEST_TOKENS || "").split(",").map((p) => p.trim().split("=")).filter((p) => p[0] && p[1])
  );
  if (!bearer || !Object.prototype.hasOwnProperty.call(tokenUsers, bearer)) {
    return new Response("unauthorized", { status: 401 });
  }
  const you = tokenUsers[bearer];

  const aliases = Object.fromEntries(
    (process.env.USER_ALIASES || "").split(",").map((p) => p.split("=").map((x) => x.trim())).filter((p) => p[0] && p[1])
  );
  const hidden = new Set((process.env.HIDE_USERS || "").split(",").map((x) => x.trim()).filter(Boolean));

  const periods = { today: 1, week: 7, month: 30 };
  const out = { you, updated: Date.now(), periods: {} };
  const dates = Array.from({ length: 30 }, (_, i) => new Date(Date.now() - i * 864e5).toISOString().slice(0, 10));
  const rows = await Promise.all(dates.map((d) => redis.hgetall(`u:${d}`)));

  for (const [name, days] of Object.entries(periods)) {
    const users = {};
    rows.slice(0, days).forEach((h) => {
      for (const [field, v] of Object.entries(h || {})) {
        const [raw, , type] = field.split("|");
        const user = aliases[raw] || raw;
        if (hidden.has(raw) || hidden.has(user)) continue;
        const u = (users[user] ||= { cost: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });
        const val = Number(v);
        if (type === "cost") u.cost += val;
        else if (type === "input") u.input += val;
        else if (type === "output") u.output += val;
        else if (type === "cacheCreation") u.cacheWrite += val;
        else if (type === "cacheRead") u.cacheRead += val;
      }
    });
    out.periods[name] = users;
  }
  return Response.json(out);
}
