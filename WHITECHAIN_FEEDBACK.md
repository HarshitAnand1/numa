# Whitechain feedback

Honest notes from building numa (a gasless USDT checkout) against Whitechain Sepolia (chain 1874). Written 2026-11-07. **The contracts are now deployed and verified on Whitechain Sepolia (see `docs/WHITECHAIN.md`), but no real USDT payment has run through them yet. The research and fork-rehearsal notes below come from our own work; the deployment section at the end is still empty and will be filled in from the real experience, not guessed.**

## What worked
- **Chain facts matched.** `cast chain-id` against the public RPC returned 1874, as documented.
- **The test USDT supports EIP-3009.** Address `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7` is an EIP-1967 proxy; its implementation bytecode contains the `receiveWithAuthorization` selectors (both the `v,r,s` and the `bytes signature` forms), `transferWithAuthorization`, `authorizationState`, `permit` and `DOMAIN_SEPARATOR`. That is exactly what a gasless, relayer-submitted payment needs.
- **We could derive the token's EIP-712 domain and check it.** `name="Tether USD"`, `version="1"`, `chainId=1874`, `verifyingContract=<proxy>`. The hash of that domain equals the contract's `DOMAIN_SEPARATOR()`, and a unit test in our repo pins it.
- Standard EVM tooling (Foundry, viem) worked against the RPC without special handling.

- **Forking the testnet with Foundry's anvil works** (`anvil --fork-url <rpc> --chain-id 1874`), including the USDT proxy. That let us rehearse the whole gasless flow against the real token's EIP-3009 before deploying. The token's `owner()` can `mint`, which made funding a test buyer easy on the fork.
- **Block time looked like about 1 second** on the public RPC (7 blocks in 6 seconds when we sampled), which keeps receipt waits short.

## Where we got stuck or found gaps
- **The USDT's EIP-712 domain wasn't something we found stated for integrators.** We reverse-engineered it from `DOMAIN_SEPARATOR()` and the bytecode. A short "integrating USDT on Whitechain Sepolia" page with the domain, the proxy and implementation addresses, and a note that `receiveWithAuthorization` requires `msg.sender == to`, would have saved real time. (If this page exists, we missed it; point us to it and we'll correct this line.)
- **Implementation source.** We could not confirm that the USDT implementation's source is published on the explorer; we relied on selector inspection instead.
- **Public RPC rate limit (50 requests/s per IP).** Fine for a demo, tight for an indexer and a release keeper that poll, which is why we plan to use the hackathon Ankr endpoint. A note on this in the "connect" docs would help.

## Still to fill in from the real deployment (TODO(team))
The contracts went live in block 12414186 (deployed by Member 1). We have not yet written up that experience, and we have not yet sent a real payment through the deployed router, so the items below stay open:
- Faucet experience: how much WBT per claim, how often, and whether it covers a relayer running for a weekend.
- Deploying with Foundry and a keystore on chain 1874: gas behaviour, any flags needed.
- Verifying contracts on the Whitechain explorer (Blockscout): steps taken, anything that failed.
- Block time and finality as observed by the relayer and keeper (receipt waits, reorgs, timeouts).
- The first real `receiveWithAuthorization` through our router: what happened.
