# CLAUDE.md — numa
Numa: drop-in USDT checkout + creator marketplace on Whitechain Sepolia (chain 1874). Creators earn commission only when a real USDT sale settles. Full brief: `initial-prompt.md`.

## Architecture (do not regress)
- Proof of conversion = a settled USDT payment. NO Stripe, NO verifier/oracle, NO campaign escrow.
- Gasless: buyer signs EIP-3009 `receiveWithAuthorization` (to = NumaRouter); relayer submits `payOrder`. Merchant signs EIP-712 order.
- Contracts: `CampaignRegistry`, `NumaRouter` (Foundry, OpenZeppelin). Money lives only on-chain.
- Arkiv: wallet-owned entities (campaign, offer, decision, link, conversion). Holds no funds/secrets. Never invent SDK APIs — read docs.
- Postgres only for order sessions/relayer queue/cache.

## Layout
apps/{web,api,demo-shop}, packages/{contracts,shared,arkiv,sdk-server,sdk-react,config}, docs/.

## Commands
`pnpm install`, `pnpm contracts:build`, `pnpm contracts:test`, `pnpm typecheck`.

## Rules
- Security: no private keys in repo/chat; relayer only calls the allowlisted router; simulate before send; verify receipts.
- Never create git commits unless asked. Never add Claude/Anthropic as contributor. Do not change git identities.
- Don't describe planned features as implemented; update `docs/PROJECT_STATUS.md` and relevant docs with changes.
- Whitechain deploys need the user's keystore (`cast wallet import`); hand commands to the user.
