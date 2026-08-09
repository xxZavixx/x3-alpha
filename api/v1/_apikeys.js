// api/v1/_apikeys.js
// Trade Intelligence API helpers: key auth + usage metering.
// Built against the existing api/_lib.js (db.get/set/del, db.incrWithTtl, token).
// Underscore prefix = not exposed as a route by Vercel.

import { db, token } from "../_lib.js";

// ---- Key format ----
// x3k_live_<40 hex chars>, stored as  apikey:<key> -> JSON record

export function generateApiKey() {
  return `x3k_live_${token().slice(0, 40)}`;
}

export async function createApiKey(ownerEmail, plan = "metered") {
  const key = generateApiKey();
  const record = {
    key,
    owner: (ownerEmail || "").toLowerCase(),
    plan,                     // 'metered' | 'unlimited'
    active: true,
    createdAt: new Date().toISOString(),
  };
  await db.set(`apikey:${key}`, JSON.stringify(record));
  return record;
}

export async function getApiKey(key) {
  if (!key || !key.startsWith("x3k_")) return null;
  const raw = await db.get(`apikey:${key}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function revokeApiKey(key) {
  const rec = await getApiKey(key);
  if (!rec) return false;
  rec.active = false;
  rec.revokedAt = new Date().toISOString();
  await db.set(`apikey:${key}`, JSON.stringify(rec));
  return true;
}

// ---- Usage metering ----
// Monthly counter: apiusage:<key>:<YYYY-MM>  (60-day TTL, covers billing reads)

function monthStamp() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function recordUsage(key) {
  const month = monthStamp();
  const monthly = await db.incrWithTtl(`apiusage:${key}:${month}`, 60 * 60 * 24 * 60);
  return { month, monthlyCalls: Number(monthly) };
}

export async function getUsage(key) {
  const month = monthStamp();
  const monthly = await db.get(`apiusage:${key}:${month}`);
  return { month, monthlyCalls: Number(monthly || 0) };
}

// ---- Rate limiting: 20 calls/min per key ----

export async function checkRateLimit(key, perMinute = 20) {
  const minute = Math.floor(Date.now() / 60000);
  const count = Number(await db.incrWithTtl(`apirate:${key}:${minute}`, 90));
  return { allowed: count <= perMinute, count, limit: perMinute };
}

// ---- Monthly quota: 500 calls/month per key (plan 'unlimited' bypasses) ----

export const MONTHLY_QUOTA = 500;

export async function checkMonthlyQuota(record) {
  if (record.plan === "unlimited") return { allowed: true, used: 0, limit: null };
  const { monthlyCalls } = await getUsage(record.key);
  return {
    allowed: monthlyCalls < MONTHLY_QUOTA,
    used: monthlyCalls,
    limit: MONTHLY_QUOTA,
  };
}

// ---- Auth helper ----
// Accepts  Authorization: Bearer <key>  or  X-API-Key: <key>

export async function authenticate(req) {
  const authHeader = req.headers["authorization"] || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  const headerKey = req.headers["x-api-key"] || null;
  const key = bearer || headerKey;

  if (!key) {
    return { ok: false, status: 401, error: "missing_api_key",
      message: "Provide your API key via Authorization: Bearer <key> or X-API-Key header." };
  }
  const record = await getApiKey(key);
  if (!record) {
    return { ok: false, status: 401, error: "invalid_api_key", message: "API key not recognized." };
  }
  if (!record.active) {
    return { ok: false, status: 403, error: "revoked_api_key", message: "This API key has been revoked." };
  }
  const rate = await checkRateLimit(key);
  if (!rate.allowed) {
    return { ok: false, status: 429, error: "rate_limited",
      message: `Rate limit exceeded (${rate.limit}/min). Slow down and retry.` };
  }
  const quota = await checkMonthlyQuota(record);
  if (!quota.allowed) {
    return { ok: false, status: 429, error: "monthly_quota_exceeded",
      message: `Monthly quota reached (${quota.used}/${quota.limit} calls). Quota resets at the start of next month (UTC). Contact api@x3digitalcapital.com to upgrade.` };
  }
  return { ok: true, record };
}
