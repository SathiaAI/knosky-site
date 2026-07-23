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
