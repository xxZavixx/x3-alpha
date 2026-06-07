// POST /api/auth/request  { email }  -> emails a one-tap sign-in link
import { json, token, db, MAGIC_TTL, appUrl, validEmail } from "../_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const email = (body.email || "").trim().toLowerCase();
    if (!validEmail(email)) return json(res, 400, { error: "Please enter a valid email address." });

    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM || "X3 Alpha <onboarding@resend.dev>";
    if (!apiKey) return json(res, 500, { error: "Email sending isn't configured (RESEND_API_KEY)." });

    const t = token();
    await db.setex(`magic:${t}`, MAGIC_TTL, email);
    const link = `${appUrl(req)}/?token=${t}`;

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;background:#030507;color:#f0f6ff;padding:32px;border-radius:12px;max-width:460px;margin:auto">
        <h2 style="color:#60a5fa;letter-spacing:1px;margin:0 0 12px">X3 ALPHA</h2>
        <p style="color:#a8b8cc;line-height:1.6">Click the button below to sign in. This link works once and expires in 15 minutes.</p>
        <p style="margin:24px 0">
          <a href="${link}" style="background:#3b82f6;color:#fff;text-decoration:none;padding:13px 28px;border-radius:8px;font-weight:bold;display:inline-block">Sign in to X3 Alpha</a>
        </p>
        <p style="color:#5a7a9a;font-size:12px;line-height:1.5">If you didn't request this, you can ignore this email. Link: ${link}</p>
      </div>`;

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [email], subject: "Your X3 Alpha sign-in link", html }),
    });

    if (!r.ok) {
      const detail = await r.text();
      return json(res, 502, { error: "Couldn't send the sign-in email.", detail: detail.slice(0, 300) });
    }
    return json(res, 200, { ok: true });
  } catch (e) {
    return json(res, 500, { error: String(e).slice(0, 300) });
  }
}