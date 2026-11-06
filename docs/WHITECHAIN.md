# Whitechain

| | |
|---|---|
| Network | Whitechain Sepolia, chain id **1874** (verified via `cast chain-id`) |
| RPC | https://rpc.testnet.whitechain.io (50 rps/IP) |
| Explorer | https://explorer.testnet.whitechain.io |
| Native gas | WBT |

## Test USDT — verified 2026-11-06
Address `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7` (from the brief) — checked on-chain:
- `name()="Tether USD"`, `symbol()="USDT"`, `decimals()=6`.
- It is an **EIP-1967 proxy**; implementation `0x26425662d126412128967ecf0a02ec48573026f7`.
- Implementation bytecode contains selectors for `receiveWithAuthorization` (both `v,r,s` 0xef55bec6 and `bytes signature` 0x88b7ab63), `transferWithAuthorization`, `authorizationState`, `permit`, `nonces`, `DOMAIN_SEPARATOR`, `mint`.
- EIP-712 domain (derived and matched against `DOMAIN_SEPARATOR()`): `name="Tether USD"`, `version="1"`, `chainId=1874`, `verifyingContract=<proxy address>`.

**Conclusion:** EIP-3009 gasless flow is feasible. Still to prove with a real `receiveWithAuthorization` transfer through a deployed router. Note: `receiveWithAuthorization` requires `msg.sender == to`, so NumaRouter must be the caller and recipient.
Not yet verified: explorer-published source for the implementation; WBT faucet steps (see `.agents/skills/whitechain-dev/references/claim-testnet-wbt.md`).

## Deploy
Use Foundry keystore (`cast wallet import <name> --interactive`) — run by a human. See `.agents/skills/whitechain-dev/references/deploy-contract.md`.

## Deployment status
Not deployed yet. Contract addresses will go in `packages/shared/src/addresses.ts` and `.env` after the first deployment (`DEPLOYMENT_CHECKLIST.md`).
