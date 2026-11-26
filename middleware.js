import { NextResponse } from "next/server";

// Password-protects the dashboard (username can be anything).
export function middleware(req) {
  const b64 = (req.headers.get("authorization") || "").split(" ")[1] || "";
  let pass = "";
  try { pass = atob(b64).split(":").slice(1).join(":"); } catch {}
  if (pass && pass === process.env.DASH_PASSWORD) return NextResponse.next();
  return new NextResponse("Password required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Claude usage"' },
  });
}

export const config = { matcher: ["/"] };
