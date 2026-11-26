import { createClient } from "redis";

// Works with the REDIS_URL that Vercel's Redis integration provides.
let pending;
function connect() {
  if (!pending) {
    pending = (async () => {
      const c = createClient({ url: process.env.REDIS_URL });
      c.on("error", () => {});
      await c.connect();
      return c;
    })().catch((e) => {
      pending = undefined;
      throw e;
    });
  }
  return pending;
}

export const redis = {
  hincrbyfloat: async (k, f, v) => (await connect()).hIncrByFloat(k, f, v),
  expire: async (k, s) => (await connect()).expire(k, s),
  hgetall: async (k) => (await connect()).hGetAll(k),
};
