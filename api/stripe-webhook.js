2 of 29,681
API FOLDER
Inbox
X <xzavierharris30@gmail.com>
	
Attachments8:36 PM (12 minutes ago)
	
	
to me
 5 Attachments
  •  Scanned by Gmail
Anti-virus warning

– 5 attachments contain a virus or blocked file. Downloading these attachments is disabled.
Mail Delivery Subsystem <mailer-daemon@googlemail.com>
	
8:36 PM (12 minutes ago)
	
	
to me
For security reasons, Gmail does not allow you to use this type of file as it violates Google policy for executables and archives.



// POST /api/stripe-webhook  -> Stripe calls this; we verify the signature
// and update the user's Pro status by email. Set the endpoint URL and the
// signing secret (STRIPE_WEBHOOK_SECRET) in your Stripe Dashboard.
import crypto from "node:crypto";
import { db, getUser, saveUser } from "./_lib.js";

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
    // Handle Vercel Functions: req.body may be pre-parsed or raw
    if (typeof req.body === "string") {
      raw = req.body;
    } else if (Buffer.isBuffer(req.body)) {
      raw = req.body.toString("utf8");
    } else if (req.body && typeof req.body === "object") {
      // If already parsed as JSON, re-stringify to verify signature
      raw = JSON.stringify(req.body);
    } else {
      // Try to read from request stream
      const chunks = [];
      for await (const c of req) chunks.push(c);
      raw = Buffer.concat(chunks).toString("utf8");
    }
  } catch (e) { res.statusCode = 400; res.end("Bad body"); return; }

  if (!secret || !verifySignature(raw, req.headers["stripe-signature"], secret)) {
    res.statusCode = 400; res.end("Invalid signature"); return;
  }

  let event;
  try { event = JSON.parse(raw); } catch { res.statusCode = 400; res.end("Bad JSON"); return; }

  try {
    const obj = (event.data && event.data.object) || {};

    if (event.type === "checkout.session.completed") {
      const email = ((obj.customer_details && obj.customer_details.email) || obj.customer_email || "").toLowerCase();
      const customerId = obj.customer;
      if (email) {
        const user = (await getUser(email)) || { email, createdAt: Date.now() };
        user.pro = true;
        if (customerId) user.customerId = customerId;
        await saveUser(user);
        if (customerId) await db.set(`customer:${customerId}`, email);
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
      }
    }

    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ received: true }));
  } catch (e) {
    console.error("Stripe webhook processing failed:", e);
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: String(e).slice(0, 300) }));
  }
}
