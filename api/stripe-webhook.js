// POST /api/stripe-webhook  -> Stripe calls this; we verify the signature
// and update the user's Pro status by email.
import crypto from "node:crypto";
import { db, getUser, saveUser } from "./_lib.js";

// REQUIRED: tells Vercel not to parse the body, so we can verify Stripe's raw bytes.
export const config = { api: { bodyParser: false } };

function verifySignature(raw, sigHeader, secret) {
  if (!sigHeader) return false;
  const parts = {};
  sigHeader.split(",").forEach((kv) => {
    const idx = kv.indexOf("=");
    if (idx > -1) {
      const k = kv.slice(0, idx).trim();
      const v = kv.slice(idx + 1).trim();
      (parts[k] = parts[k] || []).push(v);
    }
  });
  const t = parts.t && parts.t[0];
  const v1s = parts.v1 || [];
  if (!t || !v1s.length) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  return v1s.some((v) => {
    try { return crypto.timingSafeEqual(Buffer.from(v), Buffer.from(expected)); }
    catch { return false; }
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.statusCode = 405; res.end("Method not allowed"); return; }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  let raw = "";
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    raw = Buffer.concat(chunks).toString("utf8");
  } catch (e) { res.statusCode = 400; res.end("Bad body"); return; }

  if (!secret || !verifySignature(raw, req.headers["stripe-signature"], secret)) {
    res.statusCode = 400; res.end("Invalid signature"); return;
  }

  let event;
  try { event = JSON.parse(raw); } catch { res.statusCode = 400; res.end("Bad JSON"); return; }

  try {
    const obj = (event.data && event.data.object) || {};

    console.log("Stripe webhook received:", { id: event.id, type: event.type, livemode: event.livemode });

    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
      console.error("Upstash storage not configured: missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN");
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "Storage not configured on server." }));
      return;
    }

    if (event.type === "checkout.session.completed") {
      const email = ((obj.customer_details && obj.customer_details.email) || obj.customer_email || "").toLowerCase();
      const customerId = obj.customer;
      console.log("checkout.session.completed: email present?", !!email, "customerId:", customerId);
      if (email) {
        const user = (await getUser(email)) || { email, createdAt: Date.now() };
        user.pro = true;
        if (customerId) user.customerId = customerId;
        await saveUser(user);
        if (customerId) await db.set(`customer:${customerId}`, email);
        console.log("User marked Pro:", user.email);
      } else {
        console.warn("No email in checkout.session.completed; cannot mark Pro.");
      }
    } else if (event.type === "customer.subscription.deleted" || event.type === "customer.subscription.updated") {
      const customerId = obj.customer;
      const active = event.type === "customer.subscription.updated"
        ? (obj.status === "active" || obj.status === "trialing")
        : false;
      const email = customerId ? await db.get(`customer:${customerId}`) : null;
      if (email) {
        const user = (await getUser(email)) || { email };
        user.pro = active;
        await saveUser(user);
        console.log("Updated pro status:", email, active);
      } else {
        console.warn("No email mapping for customer:", customerId);
      }
    }

    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ received: true }));
  } catch (e) {
    console.error("Stripe webhook processing failed:", e);
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ received: true }));
  }
}