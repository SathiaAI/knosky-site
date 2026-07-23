# Ask KnoSky — turn on Haiku (owner)

The chatbot is **already wired** to `/api/ask` (Claude Haiku).  
Until a server key exists, it returns **503 + fallback** and the widget uses the FAQ matcher.

## What you do once (Production)

### Option A — Vercel Dashboard (easiest)

1. Open [Vercel → knosky-site → Settings → Environment Variables](https://vercel.com/)
2. Add:

| Name | Value | Environments |
| :--- | :--- | :--- |
| `ANTHROPIC_API_KEY` | your Anthropic key (`sk-ant-…`) | **Production** (and Preview if you want) |

Optional:

| Name | Value |
| :--- | :--- |
| `KS_ASK_MODEL` | `claude-haiku-4-5-20251001` (default) |

3. **Redeploy** Production (Deployments → … → Redeploy) so serverless picks up the env.

### Option B — CLI (from `research/knosky-site`)

```powershell
cd "F:\Users\PaulPoulose\AI FUNDAMENTALS\KnoForge-Suite\session-2-knosky\research\knosky-site"

# Paste when prompted (do not commit the key)
vercel env add ANTHROPIC_API_KEY production

vercel --prod
```

Fallback if you only have OpenRouter:

```powershell
vercel env add OPENROUTER_API_KEY production
```

(`/api/ask` prefers Anthropic, else OpenRouter Haiku.)

## How to know it worked

```powershell
curl -s -X POST https://www.knosky.com/api/ask `
  -H "Content-Type: application/json" `
  -d "{\"question\":\"What is a swarm?\"}"
```

- **Before key:** `503` + `"fallback":true` + missing API key message  
- **After key:** `200` + `"answer":"…"` + `"thinking":true`

On the site: Ask KnoSky → you should see **Thinking…** then a natural answer (not a canned dump).

## Safety (already built)

- Key **never** in the browser  
- Answers grounded on `assets/ks-faq.json`  
- Rate limit ~20/min/IP  
- Out-of-scope → graceful redirect topics  
- If Haiku is down → FAQ keyword backup still works  

## Cost note

Haiku is cheap; cadence depends on traffic. Rate limit + short answers keep it predictable.


## Security (already in `/api/ask`)

| Guard | Detail |
| :--- | :--- |
| **Origin allowlist** | Only knosky.com / knosky.wiki (+ localhost / knosky-site Vercel previews) |
| **CORS** | Locked to those origins — not `*` |
| **Rate limits** | ~8/minute and ~40/hour per IP (per region isolate) |
| **Body cap** | ~8KB JSON |
| **Honeypot** | Hidden `website` field must stay empty |
| **Injection filter** | Jailbreak-style prompts answered with a short refuse (no model spend when obvious) |
| **Grounding** | System prompt + FAQ; user text is treated as untrusted |
| **Output cap** | Short max tokens; strip accidental script tags |
| **Key** | Server-only `ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY` |

This is **abuse-resistant for a marketing FAQ**, not a bank vault. We still recommend watching Vercel usage after the key is live.

## Exact env names (case-sensitive)

| You can set | Also accepted |
| :--- | :--- |
| `ANTHROPIC_API_KEY` | `Anthropic_API_Key` |
| `KS_ASK_MODEL` | `Model` (e.g. `claude-haiku-4-5` → normalized to dated Haiku id) |

After adding/changing env vars: **Redeploy Production** or the serverless function keeps the old empty env.

