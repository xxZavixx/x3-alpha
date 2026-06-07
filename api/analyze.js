// POST /api/analyze  -> requires a signed-in user. Pro = unlimited.
// Free users get FREE_DAILY_LIMIT analyses per day, enforced server-side.
import { json, sessionEmail, getUser, db } from "./_lib.js";

const MODEL = "claude-haiku-4-5-20251001"; // or "claude-sonnet-4-6" for deeper analysis
const FREE_DAILY_LIMIT = Number(process.env.FREE_DAILY_LIMIT || 1);

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  try {
    const email = await sessionEmail(req);
    if (!email) return json(res, 401, { error: "Please sign in to analyze your trades." });

    const user = await getUser(email);
    const pro = !!(user && user.pro);

    if (!pro) {
      const day = new Date().toISOString().slice(0, 10);
      const used = await db.incrWithTtl(`usage:${email}:${day}`, 60 * 60 * 26);
      if (used > FREE_DAILY_LIMIT) {
        return json(res, 402, { error: "You've used your free analysis for today. Upgrade to Pro for unlimited." });
      }
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return json(res, 500, { error: "ANTHROPIC_API_KEY is not set in this project." });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const trades = Array.isArray(body.trades) ? body.trades : [];
    const context = typeof body.context === "string" ? body.context.slice(0, 2000) : "";
    if (trades.length === 0) return json(res, 400, { error: "No trades were provided to analyze." });

    const lines = trades.slice(0, 100).map((t, i) => {
      const sym = (t.symbol || "?").toString().slice(0, 24);
      const side = t.side === "Short" ? "Short" : "Long";
      const entry = Number(t.entry), exit = Number(t.exit), qty = Number(t.qty);
      let pl = "";
      if (isFinite(entry) && isFinite(exit) && isFinite(qty)) {
        const raw = (exit - entry) * qty * (side === "Short" ? -1 : 1);
        pl = ` | P/L: ${raw >= 0 ? "+" : ""}${raw.toFixed(2)}`;
      }
      const date = t.date ? ` | ${t.date}` : "";
      const notes = t.notes ? ` | notes: ${t.notes.toString().slice(0, 200)}` : "";
      return `${i + 1}. ${sym} ${side} | entry ${isFinite(entry) ? entry : "?"} -> exit ${isFinite(exit) ? exit : "?"} | qty ${isFinite(qty) ? qty : "?"}${pl}${date}${notes}`;
    });

    const system =
      "You are X3 Alpha, a sharp, experienced trading-performance coach. You analyze a trader's recent trades and give honest, specific, actionable feedback to help them improve. " +
      "You are NOT a financial advisor. Never tell the user what to buy or sell, never predict prices, and never recommend specific securities. " +
      "Focus only on their behavior, execution, risk management, position sizing, and recurring patterns in the trades they provide.\n\n" +
      "Respond in this exact structure using simple markdown headers and bullet points:\n\n" +
      "## Snapshot\n2-3 sentences interpreting their overall performance and risk behavior.\n\n" +
      "## What you're doing well\n- 2-4 concrete strengths, each tied to specific trades.\n\n" +
      "## Recurring mistakes & leaks\n- 2-4 specific, recurring errors or risk issues, tied to the trades.\n\n" +
      "## Patterns I noticed\n- 2-4 behavioral or setup patterns (e.g. oversizing, cutting winners early, signs of revenge trading, long vs short skew).\n\n" +
      "## Your action plan\n- 3-5 concrete, prioritized steps for the next sessions.\n\n" +
      "Be direct and useful, like a coach reviewing a journal. Don't pad. If the data is thin, say what else they should start tracking. " +
      "End with exactly this italic line: *X3 Alpha analyzes your past trades for patterns — it is not financial advice.*";

    const userMsg = "Here are my trades:\n\n" + lines.join("\n") + (context ? "\n\nAdditional context from me:\n" + context : "");

    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, system, messages: [{ role: "user", content: userMsg }] }),
    });

    if (!apiRes.ok) {
      const detail = await apiRes.text();
      return json(res, 502, { error: "The analysis engine returned an error. Check the API key and account balance.", detail: detail.slice(0, 400) });
    }

    const data = await apiRes.json();
    const analysis = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    return json(res, 200, { analysis, pro });
  } catch (e) {
    return json(res, 500, { error: String(e).slice(0, 300) });
  }
}