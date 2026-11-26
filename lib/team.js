// Personal tokens: INGEST_TOKENS="token1=shivam,token2=pranav" (the name is the member's id).
export function tokenUsers() {
  return Object.fromEntries(
    (process.env.INGEST_TOKENS || "").split(",").map((p) => p.trim().split("=")).filter((p) => p[0] && p[1])
  );
}

// The member id for a request's bearer token, or null.
export function memberFor(req) {
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  const users = tokenUsers();
  return bearer && Object.prototype.hasOwnProperty.call(users, bearer) ? users[bearer] : null;
}
