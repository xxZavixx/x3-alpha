// Shared helpers for X3 Alpha API functions.
// (Files starting with "_" are not treated as routes by Vercel, only imported.)
import crypto from "node:crypto";

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

export const SESSION_COOKIE = "x3a_session";
export const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days
export const MAGIC_TTL = 60 * 15;             // 15 minutes

export function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(obj));
}

export function token() {
  return crypto.randomBytes(32).toString("hex");
}

async function redis(cmd) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    throw new Error("Storage isn't configured (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN).");
  }
  const r = await fetch(REDIS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const data = await r.json();
  if (data && data.error) throw new Error("Storage error: " + data.error);
  return data.result;
}

export const db = {
  get: (k) => redis(["GET", k]),
  set: (k, v) => redis(["SET", k, v]),
  setex: (k, ttl, v) => redis(["SET", k, v, "EX", String(ttl)]),
  del: (k) => redis(["DEL", k]),
  async incrWithTtl(k, ttl) {
    const n = await redis(["INCR", k]);
    if (n === 1) await redis(["EXPIRE", k, String(ttl)]);
    return n;
  },
};

export async function getUser(email) {
  const raw = await db.get(`user:${email}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
export async function saveUser(u) {
  await db.set(`user:${u.email}`, JSON.stringify(u));
}

export function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

export async function sessionEmail(req) {
  const sid = parseCookies(req)[SESSION_COOKIE];
  if (!sid) return null;
  return await db.get(`session:${sid}`);
}

export function setSessionCookie(res, sid) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${sid}; HttpOnly; Secure; Path=/; Max-Age=${SESSION_TTL}; SameSite=Lax`
  );
}
export function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; Secure; Path=/; Max-Age=0; SameSite=Lax`);
}

export function appUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${host}`;
}

export function validEmail(e) {
  return typeof e === "string" && e.length <= 200 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
}
