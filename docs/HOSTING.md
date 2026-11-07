# Hosting on Render (free tier)

`render.yaml` at the repo root defines the API, a Postgres database and the two static sites. **Nothing is deployed yet**, and this blueprint has not been validated by Render itself (Render checks it when you create it). The API cannot start until the contracts exist: it requires the router and registry addresses.

## Before you start
1. Contracts deployed (Member 1) with addresses at hand, and the router's **deployment block**.
2. A **dedicated relayer wallet** (never reuse a deployer or merchant key): `cast wallet new`, then fund it with WBT from https://faucet.testnet.whitechain.io. Keep its key out of git and chat.
3. A merchant payout-signer key if you want the demo `POST /orders` (it must be the campaign's `payoutSigner`).
4. A free Arkiv access key and a funded Arkiv writer wallet if you want discovery and conversion mirroring (optional).
5. Run `pnpm --filter @numa/api preflight -- --campaign <id>` locally with the same values first. Fix every FAIL.

## Create it
1. Render dashboard → **New → Blueprint**, connect GitHub (a private repo works once you authorise Render), pick this repo and branch `main`.
2. Render lists every `sync: false` variable and asks for it. Fill them in (keys go only here):
   - `NUMA_ROUTER_ADDRESS`, `CAMPAIGN_REGISTRY_ADDRESS`, `INDEXER_START_BLOCK` (the deployment block)
   - `RELAYER_PRIVATE_KEY`, optionally `MERCHANT_SIGNER_KEY`, `ARKIV_WRITER_PRIVATE_KEY`, `ARKIV_ACCESS_KEY`, `AGENT_WALLET_PRIVATE_KEY`, `ANTHROPIC_API_KEY`
   - `VITE_API_URL` (both static sites) = the API's URL. Render gives it as `https://numa-api.onrender.com` unless that name is taken; if it differs, set it after the first deploy and redeploy the sites.
   - `VITE_CAMPAIGN_ID` (demo shop) = the campaign id created on-chain.
   - `CORS_ORIGINS` = the two site URLs, comma-separated, e.g. `https://numa-web.onrender.com,https://numa-demo-shop.onrender.com`. `CHECKOUT_BASE_URL` = the demo shop URL.
3. Apply. The API builds from `docker/api.Dockerfile` (verified to build and boot locally with Render-style env, 2026-11-07); the sites build with pnpm.
4. Open `https://<api>/health`: it shows the relayer address and its WBT balance. Top it up if zero.

## The free-tier caveats (check Render's current terms)
- **Free web services sleep after about 15 minutes idle.** A sleeping API pauses the indexer, keeper and reconciler, and the first request after a nap is slow. Keep it awake with a free uptime monitor (for example UptimeRobot) pinging `https://<api>/health` every 5 minutes, and still expect a cold start after a deploy. Nothing is lost while asleep: the indexer resumes from its stored cursor and the keeper releases whatever is due.
- **Free Postgres on Render expires** (it has been time-limited). If it does, either upgrade it or use a free Neon or Supabase database: remove the `databases:` block and `DATABASE_URL` link, and set `DATABASE_URL` to the external connection string. Without any Postgres the API still runs but relay claims and the indexer cursor are in memory and reset on restart, which weakens duplicate protection.
- **Free instances have small memory (512 MB).** The API is light, but watch the first build.
- The Whitechain public RPC is limited to 50 requests/second per IP; the indexer and keeper poll. The hackathon's free Ankr endpoint is a better `WHITECHAIN_RPC_URL`.

## After it is up
- `pnpm --filter @numa/api preflight` against the same env (or hit `/health`).
- Do one real purchase from the demo shop with a wallet that holds test USDT and **zero WBT**; keep the explorer link for the README.
- The relayer wallet is a hot key with a daily cap (`RELAYER_DAILY_CAP_WBT`). Keep its balance small.

## Alternatives
Your own machine plus a Cloudflare quick tunnel (free, no account) works for a demo while the laptop stays awake; run the same Docker image with the same env. A small VPS with `docker compose --profile app up` also works (see `DEVELOPMENT.md`).
