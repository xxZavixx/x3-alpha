// api/v1/keys.js
// Admin-only key management for the Trade Intelligence API.
// Protected by the X3_ADMIN_SECRET env var — only you can call this.
//
//   POST /api/v1/keys   { action: "create", owner: "buyer@email.com" }
//   POST /api/v1/keys   { action: "revoke", key: "x3k_live_..." }
//   POST /api/v1/keys   { action: "usage",  key: "x3k_live_..." }
//
// Header required:  X-Admin-Secret: <your X3_ADMIN_SECRET>

import { json } from "../_lib.js";
import { createApiKey, revokeApiKey, getApiKey, getUsage } from "./_apikeys.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });

  const secret = process.env.X3_ADMIN_SECRET;
  if (!secret) return json(res, 500, { error: "server_config", message: "X3_ADMIN_SECRET is not set in Vercel." });
  if (req.headers["x-admin-secret"] !== secret) {
    return json(res, 401, { error: "unauthorized" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const { action } = body;

    if (action === "create") {
      const record = await createApiKey(body.owner || "unassigned");
      return json(res, 200, { ok: true, apiKey: record.key, owner: record.owner, createdAt: record.createdAt });
    }

    if (action === "revoke") {
      if (!body.key) return json(res, 400, { error: "missing_key" });
      const done = await revokeApiKey(body.key);
      return json(res, done ? 200 : 404, done ? { ok: true, revoked: body.key } : { error: "key_not_found" });
    }

    if (action === "usage") {
      if (!body.key) return json(res, 400, { error: "missing_key" });
      const rec = await getApiKey(body.key);
      if (!rec) return json(res, 404, { error: "key_not_found" });
      const usage = await getUsage(body.key);
      return json(res, 200, { ok: true, key: body.key, owner: rec.owner, active: rec.active, usage });
    }

    return json(res, 400, { error: "unknown_action", message: 'action must be "create", "revoke", or "usage".' });
  } catch (e) {
    console.error("keys_admin_error", String(e).slice(0, 300));
    return json(res, 500, { error: "internal_error" });
  }
}
