import { createPublicClient, createWalletClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { http, type Account, type Transport } from "viem";

/** Arkiv testnet "Rabdi" (chain 7794095, gas in tGLM). Access key is optional but the public endpoint is heavily rate limited. */
export function arkivChain(accessKey = "") {
  return rabdi({ accessKey });
}

export function createArkivReader(accessKey = "") {
  return createPublicClient({ chain: arkivChain(accessKey), transport: http() });
}

/** Server-side writer, e.g. the Numa conversion writer wallet. Browser wallets pass their own account/transport. */
export function createArkivWriter(opts: { account: Account; accessKey?: string; transport?: Transport }) {
  return createWalletClient({ chain: arkivChain(opts.accessKey), transport: opts.transport ?? http(), account: opts.account });
}

export type ArkivReader = ReturnType<typeof createArkivReader>;
export type ArkivWriter = ReturnType<typeof createArkivWriter>;
