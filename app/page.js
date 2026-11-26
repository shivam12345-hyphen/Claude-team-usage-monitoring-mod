import { redis } from "../lib/redis";

export const dynamic = "force-dynamic";

const n = (x) => Math.round(x).toLocaleString("en-US");
const short = (x) => (x >= 1e6 ? (x / 1e6).toFixed(1) + "M" : x >= 1e3 ? (x / 1e3).toFixed(1) + "K" : String(Math.round(x)));

export default async function Page({ searchParams }) {
  const days = [7, 30, 90].includes(Number(searchParams?.days)) ? Number(searchParams.days) : 30;
  const sort = searchParams?.sort === "tokens" ? "tokens" : "cost";
  const dates = Array.from({ length: days }, (_, i) => new Date(Date.now() - i * 864e5).toISOString().slice(0, 10)).reverse();
  const rows = await Promise.all(dates.map((d) => redis.hgetall(`u:${d}`)));

  // USER_ALIASES="old@email.com=shivam,other=name" shows old entries under a chosen name
  const aliases = Object.fromEntries(
    (process.env.USER_ALIASES || "").split(",").map((p) => p.split("=").map((x) => x.trim())).filter((p) => p[0] && p[1])
  );
  const users = {};
  const daily = dates.map(() => 0);
  rows.forEach((h, i) => {
    for (const [field, v] of Object.entries(h || {})) {
      const [rawUser, model, type] = field.split("|");
      const user = aliases[rawUser] || rawUser;
      const u = (users[user] ||= { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0, tokens: 0, models: {} });
      const val = Number(v);
      if (type === "cost") { u.cost += val; daily[i] += val; continue; }
      if (type === "input") u.input += val;
      else if (type === "output") u.output += val;
      else if (type === "cacheCreation") u.cacheWrite += val;
      else if (type === "cacheRead") { u.cacheRead += val; continue; } // re-read context, not new usage
      else continue;
      u.tokens += val;
      u.models[model] = (u.models[model] || 0) + val;
    }
  });

  const list = Object.entries(users).sort((a, b) => b[1][sort] - a[1][sort]);
  const totalCacheRead = list.reduce((s, [, u]) => s + u.cacheRead, 0);
  const totalCost = list.reduce((s, [, u]) => s + u.cost, 0);
  const totalTokens = list.reduce((s, [, u]) => s + u.tokens, 0);
  const top = list[0]?.[1][sort] || 1;
  const dMax = Math.max(...daily, 0.0001);
  const val = (u) => (sort === "cost" ? "$" + u.cost.toFixed(2) : short(u.tokens));

  return (
    <main>
      <style>{css}</style>
      <header>
        <h1>Claude Code usage</h1>
        <nav>
          {[7, 30, 90].map((d) => (
            <a key={d} href={`/?days=${d}&sort=${sort}`} className={d === days ? "on" : ""}>Last {d} days</a>
          ))}
        </nav>
      </header>

      <section className="stats">
        <div><b>${totalCost.toFixed(2)}</b><span>estimated spend</span></div>
        <div><b>{short(totalTokens)}</b><span>new tokens · {short(totalCacheRead)} cache reads</span></div>
        <div><b>{list.length}</b><span>active {list.length === 1 ? "person" : "people"}</span></div>
        <div><b>${list.length ? (totalCost / list.length).toFixed(2) : "0.00"}</b><span>average per person</span></div>
      </section>

      {list.length === 0 ? (
        <p className="empty">No data yet. Once a teammate's Claude Code sends its first metrics, they appear here within a minute or two.</p>
      ) : (
        <>
          <h2>Daily spend, everyone combined</h2>
          <div className="days" role="img" aria-label="Daily spend bars">
            {daily.map((v, i) => (
              <div key={i} title={`${dates[i]}: $${v.toFixed(2)}`} style={{ height: `${Math.max((v / dMax) * 100, v > 0 ? 3 : 0)}%` }} />
            ))}
          </div>

          <div className="lbhead">
            <h2>Leaderboard</h2>
            <nav>
              <a href={`/?days=${days}&sort=cost`} className={sort === "cost" ? "on" : ""}>By spend</a>
              <a href={`/?days=${days}&sort=tokens`} className={sort === "tokens" ? "on" : ""}>By tokens</a>
            </nav>
          </div>
          <ol className="lb">
            {list.slice(0, 10).map(([user, u], i) => (
              <li key={user} className={i < 3 ? "podium" : ""}>
                <span className="rank">{i + 1}</span>
                <span className="who">{user}</span>
                <span className="track"><i style={{ width: `${(u[sort] / top) * 100}%` }} /></span>
                <span className="v">{val(u)}</span>
              </li>
            ))}
          </ol>

          <h2>Everyone</h2>
          <div className="wrap">
            <table>
              <thead>
                <tr><th>Person</th><th className="r">Spend</th><th className="r">Share</th><th className="r">Input</th><th className="r">Output</th><th className="r">Cache write</th><th className="r">Cache read</th><th>Models</th></tr>
              </thead>
              <tbody>
                {list.map(([user, u]) => (
                  <tr key={user}>
                    <td>{user}</td>
                    <td className="r">${u.cost.toFixed(2)}</td>
                    <td className="r">{totalCost ? Math.round((u.cost / totalCost) * 100) : 0}%</td>
                    <td className="r">{n(u.input)}</td>
                    <td className="r">{n(u.output)}</td>
                    <td className="r">{n(u.cacheWrite)}</td>
                    <td className="r">{n(u.cacheRead)}</td>
                    <td className="m">{Object.keys(u.models).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}

const css = `
body{margin:0;background:#f7f8fa;color:#1c2333;font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:980px;margin:0 auto;padding:40px 20px 64px}
header,.lbhead{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:12px}
h1{font-size:24px;margin:0;font-weight:650}
h2{font-size:17px;margin:40px 0 14px;font-weight:650}
.lbhead h2{margin-bottom:14px}
nav a{color:#51607a;text-decoration:none;margin-left:16px;padding-bottom:2px}
nav a.on{color:#1c2333;border-bottom:2px solid #2d5bd3}
nav a:focus-visible{outline:2px solid #2d5bd3;outline-offset:3px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:24px}
.stats div{background:#fff;border:1px solid #dfe3ea;border-radius:6px;padding:14px 16px}
.stats b{display:block;font-size:24px;font-weight:650;font-variant-numeric:tabular-nums}
.stats span{color:#51607a;font-size:13px}
.empty{color:#51607a;max-width:60ch;margin-top:32px}
.days{display:flex;align-items:flex-end;gap:2px;height:110px;background:#fff;border:1px solid #dfe3ea;border-radius:6px;padding:12px}
.days div{flex:1;background:#2d5bd3;border-radius:2px 2px 0 0;min-width:2px}
.lb{list-style:none;margin:0;padding:0;background:#fff;border:1px solid #dfe3ea;border-radius:6px}
.lb li{display:grid;grid-template-columns:32px minmax(120px,240px) 1fr 80px;align-items:center;gap:12px;padding:11px 16px;border-bottom:1px solid #eceff4}
.lb li:last-child{border-bottom:0}
.rank{font-weight:650;color:#51607a;font-variant-numeric:tabular-nums}
.podium .rank{color:#2d5bd3;font-size:18px}
.podium .who{font-weight:600}
.who{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.track{background:#eceff4;height:8px;border-radius:4px;overflow:hidden}
.track i{display:block;height:100%;background:#2d5bd3;border-radius:4px;min-width:2px}
.v{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
.wrap{overflow-x:auto;background:#fff;border:1px solid #dfe3ea;border-radius:6px}
table{border-collapse:collapse;width:100%;min-width:700px}
th,td{padding:11px 14px;text-align:left;border-bottom:1px solid #eceff4;white-space:nowrap}
th{font-weight:600;color:#51607a;font-size:13px}
tr:last-child td{border-bottom:0}
.r{text-align:right;font-variant-numeric:tabular-nums}
.m{color:#51607a;font-size:13px;white-space:normal}
@media(max-width:560px){.lb li{grid-template-columns:28px 1fr 64px}.track{display:none}}
`;
