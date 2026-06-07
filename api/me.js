// GET /api/me  -> { authenticated, email, pro }
import { json, sessionEmail, getUser } from "./_lib.js";

export default async function handler(req, res) {
  try {
    const email = await sessionEmail(req);
    if (!email) return json(res, 200, { authenticated: false });
    const user = await getUser(email);
    return json(res, 200, { authenticated: true, email, pro: !!(user && user.pro) });
  } catch (e) {
    return json(res, 500, { error: String(e).slice(0, 300) });
  }
}