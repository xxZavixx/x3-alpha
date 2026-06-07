// POST /api/logout  -> ends the session
import { json, parseCookies, db, clearSessionCookie, SESSION_COOKIE } from "./_lib.js";

export default async function handler(req, res) {
  try {
    const sid = parseCookies(req)[SESSION_COOKIE];
    if (sid) await db.del(`session:${sid}`);
    clearSessionCookie(res);
    return json(res, 200, { ok: true });
  } catch (e) {
    return json(res, 500, { error: String(e).slice(0, 300) });
  }
}
