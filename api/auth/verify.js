// POST /api/auth/verify  { token }  -> validates link, starts a session
import { json, token, db, getUser, saveUser, setSessionCookie, SESSION_TTL } from "../_lib.js";

export default async function handler(req, res) {
  try {
    let t;
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      t = body.token;
    } else {
      t = req.query && req.query.token;
    }
    if (!t) return json(res, 400, { error: "Missing sign-in token." });

    const email = await db.get(`magic:${t}`);
    if (!email) return json(res, 400, { error: "This sign-in link is invalid or has expired." });
    await db.del(`magic:${t}`); // one-time use

    let user = await getUser(email);
    if (!user) {
      user = { email, pro: false, createdAt: Date.now() };
      await saveUser(user);
    }

    const sid = token();
    await db.setex(`session:${sid}`, SESSION_TTL, email);
    setSessionCookie(res, sid);
    return json(res, 200, { ok: true, email, pro: !!user.pro });
  } catch (e) {
    return json(res, 500, { error: String(e).slice(0, 300) });
  }
}