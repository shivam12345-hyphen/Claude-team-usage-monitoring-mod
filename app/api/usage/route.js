import { redis } from "../../../lib/redis";
import { memberFor } from "../../../lib/team";

export const dynamic = "force-dynamic";

const PERIODS = { today: 1, week: 7, month: 30 };
const blank = () => ({ cost: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });

// Team usage for the Claude mod. A personal token may read it, and reading counts as "I have it installed".
export async function GET(req) {
  const you = memberFor(req);
  if (!you) return new Response("unauthorized", { status: 401 });

  const aliases = Object.fromEntries(
    (process.env.USER_ALIASES || "").split(",").map((p) => p.split("=").map((x) => x.trim())).filter((p) => p[0] && p[1])
  );
  const hidden = new Set((process.env.HIDE_USERS || "").split(",").map((x) => x.trim()).filter(Boolean));

  await redis.hset("members", you, Date.now()); // heartbeat: this member has the mod installed
  const [seen, names] = await Promise.all([redis.hgetall("members"), redis.hgetall("names")]);
  const nameOf = (id) => names[id] || id;

  const dates = Array.from({ length: 30 }, (_, i) => new Date(Date.now() - i * 864e5).toISOString().slice(0, 10));
  const rows = await Promise.all(dates.map((d) => redis.hgetall(`u:${d}`)));

  const out = { you, youName: nameOf(you), nameSet: Boolean(names[you]), updated: Date.now(), periods: {} };
  for (const [period, days] of Object.entries(PERIODS)) {
    const people = {};
    // everyone who installed the mod is listed, even with no usage yet
    for (const id of Object.keys(seen)) {
      if (!hidden.has(id)) people[id] = { name: nameOf(id), seen: Number(seen[id]) || 0, installed: true, ...blank() };
    }
    rows.slice(0, days).forEach((h) => {
      for (const [field, v] of Object.entries(h || {})) {
        const [raw, , type] = field.split("|");
        const id = aliases[raw] || raw;
        if (hidden.has(raw) || hidden.has(id)) continue;
        const u = (people[id] ||= { name: nameOf(id), seen: 0, installed: false, ...blank() });
        const val = Number(v);
        if (type === "cost") u.cost += val;
        else if (type === "input") u.input += val;
        else if (type === "output") u.output += val;
        else if (type === "cacheCreation") u.cacheWrite += val;
        else if (type === "cacheRead") u.cacheRead += val;
      }
    });
    out.periods[period] = people;
  }
  return Response.json(out);
}
