import { redis } from "../../../lib/redis";

export const dynamic = "force-dynamic";

const attrs = (list = []) =>
  Object.fromEntries(
    list.map((a) => [a.key, a.value?.stringValue ?? a.value?.intValue ?? a.value?.doubleValue ?? ""])
  );

// Receives OTLP/HTTP JSON metrics from Claude Code.
export async function POST(req) {
  // INGEST_TOKENS="tokenA=shivam,tokenB=pranav": the token decides who the usage belongs to.
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  const tokenUsers = Object.fromEntries(
    (process.env.INGEST_TOKENS || "").split(",").map((p) => p.trim().split("=")).filter((p) => p[0] && p[1])
  );
  const tokenName = Object.prototype.hasOwnProperty.call(tokenUsers, bearer) ? tokenUsers[bearer] : null;
  const sharedOk = process.env.INGEST_TOKEN && bearer === process.env.INGEST_TOKEN;
  if (!bearer || (!tokenName && !sharedOk)) {
    return new Response("unauthorized", { status: 401 });
  }
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response("set OTEL_EXPORTER_OTLP_PROTOCOL=http/json", { status: 415 });
  }

  const inc = {};
  for (const rm of body.resourceMetrics || []) {
    const res = attrs(rm.resource?.attributes);
    for (const sm of rm.scopeMetrics || []) {
      for (const m of sm.metrics || []) {
        const kind =
          m.name === "claude_code.token.usage" ? "tok" : m.name === "claude_code.cost.usage" ? "cost" : null;
        if (!kind) continue;
        for (const p of m.sum?.dataPoints || []) {
          const a = { ...res, ...attrs(p.attributes) };
          const user = tokenName || a["member.name"] || a["user.email"] || a["user.account_uuid"] || a["user.id"] || "unknown";
          const model = a.model || "unknown";
          const field = `${user}|${model}|${kind === "cost" ? "cost" : a.type || "other"}`;
          inc[field] = (inc[field] || 0) + Number(p.asDouble ?? p.asInt ?? 0);
        }
      }
    }
  }

  const key = `u:${new Date().toISOString().slice(0, 10)}`;
  await Promise.all(Object.entries(inc).map(([f, v]) => redis.hincrbyfloat(key, f, v)));
  if (Object.keys(inc).length) await redis.expire(key, 60 * 60 * 24 * 400);
  return Response.json({});
}
