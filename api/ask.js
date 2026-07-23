/**
 * Ask KnoSky — Vercel serverless (Haiku).
 * Key stays server-side: ANTHROPIC_API_KEY (preferred) or OPENROUTER_API_KEY.
 * Grounds answers on published FAQ; refuses out-of-scope inventing.
 */
const fs = require("fs");
const path = require("path");

const MODEL_ANTHROPIC = process.env.KS_ASK_MODEL || "claude-haiku-4-5-20251001";
const MODEL_OPENROUTER = process.env.KS_ASK_MODEL_OPENROUTER || "anthropic/claude-haiku-4.5";
const MAX_Q = 400;
const MAX_HISTORY = 6;
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;

// Best-effort rate limit (per isolate; enough to blunt casual abuse)
const buckets = new Map();

function clientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length) return xf.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function rateLimit(ip) {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b || now - b.start > WINDOW_MS) {
    b = { start: now, n: 0 };
    buckets.set(ip, b);
  }
  b.n += 1;
  return b.n <= MAX_PER_WINDOW;
}

function loadFaq() {
  const candidates = [
    path.join(process.cwd(), "assets", "ks-faq.json"),
    path.join(__dirname, "..", "assets", "ks-faq.json"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, "utf8"));
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

function faqCorpus(faq) {
  if (!faq || !Array.isArray(faq.entries)) return "(FAQ unavailable)";
  return faq.entries
    .map((e) => {
      const links = (e.links || [])
        .map((L) => `- ${L.label || "link"}: ${L.href}`)
        .join("\n");
      return [
        `### ${e.title || e.id}`,
        `id: ${e.id}`,
        `SIMPLE:\n${e.simple || e.answer || ""}`,
        e.technical ? `MORE DETAIL:\n${e.technical}` : "",
        links ? `LINKS:\n${links}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");
}

function systemPrompt(corpus) {
  return `You are **Ask KnoSky**, the on-site helper for knosky.com and knosky.wiki.

## Voice
- Plain English first. Assume a smart product owner, not a deep engineer.
- Short paragraphs. Use bullets when helpful.
- Be warm and clear — actually answer the question asked.
- If they want depth, add a short "A bit more detail" section after the plain answer.
- Never dump internal ticket IDs (SAT-###), DEC-###, P0/P1, Wave 1, SSOT, or "Do not market".

## Product truth (from published FAQ — stay faithful)
${corpus}

## Hard rules
1. Answer using the FAQ material above + general knowledge of public pages (knosky.com, knosky.wiki, GitHub SathiaAI/knosky). Prefer FAQ wording for claims.
2. If the question is clearly outside KnoSky (crypto prices, unrelated products, medical, etc.), say so briefly and offer 2–3 in-scope topics (install, what KnoSky is, package, privacy, swarm/L3, packs).
3. Do not invent features, enterprise SLAs, or "swarm-safe everywhere". L3 = early multi-helper foundation, not finished fleet product.
4. Do not claim source code is uploaded by default (local-first).
5. Install truth: \`npx knosky@latest .\` needs Node 20+.
6. When relevant binary path exists in FAQ links, include 1–2 markdown links at the end.
7. No roleplay as a coding agent that can run tools on the user's machine — you only explain.

## Output
Markdown is OK (**bold**, \`code\`, links). No HTML. Keep answers concise (usually under ~180 words unless they asked for deep detail).`;
}

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

async function callAnthropic(apiKey, system, messages) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL_ANTHROPIC,
      max_tokens: 700,
      temperature: 0.3,
      system,
      messages,
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data?.error?.message || data?.message || `anthropic ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  const text = (data.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n")
    .trim();
  return { text, model: data.model || MODEL_ANTHROPIC, provider: "anthropic" };
}

async function callOpenRouter(apiKey, system, messages) {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://www.knosky.com/",
      "X-Title": "Ask KnoSky",
    },
    body: JSON.stringify({
      model: MODEL_OPENROUTER,
      temperature: 0.3,
      max_tokens: 700,
      messages: [{ role: "system", content: system }, ...messages],
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data?.error?.message || data?.message || `openrouter ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  const text = (data.choices?.[0]?.message?.content || "").trim();
  return {
    text,
    model: data.model || MODEL_OPENROUTER,
    provider: "openrouter",
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== "POST") {
    return json(res, 405, { error: "POST only" });
  }

  const ip = clientIp(req);
  if (!rateLimit(ip)) {
    return json(res, 429, {
      error: "Too many questions — wait a minute and try again.",
      fallback: true,
    });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body || "{}");
    } catch {
      return json(res, 400, { error: "Invalid JSON", fallback: true });
    }
  }
  body = body || {};

  const question = String(body.question || body.q || "").trim();
  if (!question || question.length > MAX_Q) {
    return json(res, 400, {
      error: "Ask a short question (1–400 characters).",
      fallback: true,
    });
  }

  const historyIn = Array.isArray(body.history) ? body.history : [];
  const history = historyIn
    .slice(-MAX_HISTORY)
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || "").slice(0, 1200),
    }))
    .filter((m) => m.content);

  const faq = loadFaq();
  const system = systemPrompt(faqCorpus(faq));
  const messages = [...history, { role: "user", content: question }];

  const anthropicKey = process.env.ANTHROPIC_API_KEY || "";
  const openrouterKey = process.env.OPENROUTER_API_KEY || "";

  if (!anthropicKey && !openrouterKey) {
    return json(res, 503, {
      error: "Ask KnoSky is not configured yet (missing API key on the server).",
      fallback: true,
    });
  }

  try {
    let out;
    if (anthropicKey) {
      out = await callAnthropic(anthropicKey, system, messages);
    } else {
      out = await callOpenRouter(openrouterKey, system, messages);
    }
    if (!out.text) {
      return json(res, 502, {
        error: "Empty model response",
        fallback: true,
      });
    }
    return json(res, 200, {
      answer: out.text,
      model: out.model,
      provider: out.provider,
      thinking: true,
    });
  } catch (e) {
    console.error("ask error", e?.message || e);
    return json(res, 502, {
      error: "Model unavailable right now.",
      detail: String(e?.message || e).slice(0, 200),
      fallback: true,
    });
  }
};
