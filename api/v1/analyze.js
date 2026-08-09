// api/v1/analyze.js
// Trade Intelligence API — agent-facing endpoint.
//
// POST /api/v1/analyze
// Auth:  Authorization: Bearer x3k_live_...   (or X-API-Key header)
// Body:  { trades: [{symbol, direction, entry, exit, qty, date?, notes?}], context? }
//
// Returns structured JSON (scores, grades, flags, recommendations) for
// machine consumption. Does not touch sessions, users, or the web app.

import { json } from "../_lib.js";
import { authenticate, recordUsage, MONTHLY_QUOTA } from "./_apikeys.js";

const MAX_TRADES = 100;
const MODEL = "claude-haiku-4-5-20251001";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed", message: "Use POST." });

  try {
    // ---- Auth (API key) + rate limit ----
    const auth = await authenticate(req);
    if (!auth.ok) return json(res, auth.status, { error: auth.error, message: auth.message });

    // ---- Parse + validate input ----
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const trades = body.trades;
    const context = body.context;

    if (!Array.isArray(trades) || trades.length === 0) {
      return json(res, 400, { error: "invalid_input", message: 'Body must include a non-empty "trades" array.' });
    }
    if (trades.length > MAX_TRADES) {
      return json(res, 400, { error: "too_many_trades", message: `Max ${MAX_TRADES} trades per request.` });
    }

    const clean = [];
    for (const t of trades) {
      const entry = Number(t.entry), exit = Number(t.exit), qty = Number(t.qty);
      if (!t.symbol || !t.direction || !isFinite(entry) || !isFinite(exit) || !isFinite(qty) || qty <= 0) {
        return json(res, 400, {
          error: "invalid_trade",
          message: 'Each trade needs: symbol (string), direction ("long"|"short"), entry (number), exit (number), qty (number > 0). Optional: date, notes.',
        });
      }
      const dir = String(t.direction).toLowerCase() === "short" ? "short" : "long";
      const pl = dir === "long" ? (exit - entry) * qty : (entry - exit) * qty;
      clean.push({
        symbol: String(t.symbol).toUpperCase().slice(0, 12),
        direction: dir,
        entry, exit, qty,
        date: t.date ? String(t.date).slice(0, 32) : null,
        notes: t.notes ? String(t.notes).slice(0, 500) : null,
        pl: Math.round(pl * 100) / 100,
      });
    }

    // ---- Deterministic metrics (computed server-side) ----
    const wins = clean.filter(t => t.pl > 0);
    const losses = clean.filter(t => t.pl < 0);
    const netPL = Math.round(clean.reduce((s, t) => s + t.pl, 0) * 100) / 100;
    const grossWin = wins.reduce((s, t) => s + t.pl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pl, 0));
    const metrics = {
      trades: clean.length,
      netPL,
      winRate: clean.length ? Math.round((wins.length / clean.length) * 1000) / 10 : 0,
      profitFactor: grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : (grossWin > 0 ? null : 0),
      avgWin: wins.length ? Math.round((grossWin / wins.length) * 100) / 100 : 0,
      avgLoss: losses.length ? Math.round((grossLoss / losses.length) * 100) / 100 : 0,
      largestWin: wins.length ? Math.max(...wins.map(t => t.pl)) : 0,
      largestLoss: losses.length ? Math.min(...losses.map(t => t.pl)) : 0,
    };

    // ---- AI scoring (strict JSON out) ----
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return json(res, 500, { error: "server_config", message: "Analysis engine unavailable." });

    const system = `You are the scoring engine of a Trade Intelligence API. You receive a trader's trades, computed metrics, and optional context. Respond ONLY with valid JSON matching exactly this schema — no markdown, no prose outside JSON:
{
  "scores": { "overall": <0-100 int>, "riskManagement": <0-100 int>, "consistency": <0-100 int>, "discipline": <0-100 int>, "edgeClarity": <0-100 int> },
  "grade": "<A|B|C|D|F>",
  "summary": "<one sentence, max 200 chars>",
  "strengths": ["<short string>"],
  "riskFlags": [{"flag": "<snake_case_id>", "severity": "<low|medium|high>", "detail": "<short string>"}],
  "recommendations": [{"action": "<short imperative>", "priority": <1-5 int>, "detail": "<short string>"}],
  "sampleSizeWarning": <true if fewer than 10 trades>
}
Limits: strengths max 4, riskFlags max 5, recommendations max 5.
Scoring guidance: be honest and calibrated, not generous. With <10 trades, overall should rarely exceed 70. Missing stops/exit logic lowers riskManagement. Date inconsistencies lower discipline. Base everything ONLY on the data provided. You are not a financial advisor; never recommend buying or selling any security.`;

    const userMsg = `TRADES:\n${JSON.stringify(clean)}\n\nCOMPUTED METRICS:\n${JSON.stringify(metrics)}\n\nTRADER CONTEXT: ${context ? String(context).slice(0, 1000) : "(none provided)"}`;

    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1200, system, messages: [{ role: "user", content: userMsg }] }),
    });

    if (!apiRes.ok) {
      const detail = await apiRes.text();
      console.error("anthropic_error", apiRes.status, detail.slice(0, 300));
      return json(res, 502, { error: "analysis_failed", message: "Analysis engine error. Retry shortly." });
    }

    const data = await apiRes.json();
    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
    let analysis;
    try {
      const jsonText = text.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "").trim();
      analysis = JSON.parse(jsonText);
    } catch (e) {
      console.error("analysis_parse_error", e.message, text.slice(0, 200));
      return json(res, 502, { error: "analysis_failed", message: "Analysis engine returned an unreadable result. Retry shortly." });
    }

    // ---- Meter the successful call ----
    const usage = await recordUsage(auth.record.key);

    return json(res, 200, {
      object: "trade_analysis",
      version: "v1",
      generatedAt: new Date().toISOString(),
      metrics,
      analysis,
      usage: { month: usage.month, callsThisMonth: usage.monthlyCalls, monthlyLimit: auth.record.plan === "unlimited" ? null : MONTHLY_QUOTA },
      disclaimer: "X3 Alpha analyzes past trades for patterns. Not financial advice.",
    });
  } catch (e) {
    console.error("v1_analyze_error", String(e).slice(0, 300));
    return json(res, 500, { error: "internal_error", message: "Unexpected error." });
  }
}
