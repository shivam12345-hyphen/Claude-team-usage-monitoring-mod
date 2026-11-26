import { createClient } from "redis";

// Works with the REDIS_URL that Vercel's Redis integration provides.
let pending;
function connect() {
  if (!pending) {
    pending = (async () => {
      if (!process.env.REDIS_URL) throw new Error("REDIS_URL is not set: connect a Redis database to this Vercel project");
      const c = createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: 5000 } });
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
  hset: async (k, f, v) => (await connect()).hSet(k, f, String(v)),
  hgetall: async (k) => (await connect()).hGetAll(k),
};
