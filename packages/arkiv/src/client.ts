import { createPublicClient, createWalletClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { http, type Account, type Address, type Transport } from "viem";
import { createSafeWriter, type SafeWriter, type SafeWriterOptions } from "./safeWriter.js";

/** Arkiv testnet "Rabdi" (chain 7794095, gas in tGLM). Access key is optional but the public endpoint is heavily rate limited. */
export function arkivChain(accessKey = "") {
  return rabdi({ accessKey });
}

export function createArkivReader(accessKey = "") {
  return createPublicClient({ chain: arkivChain(accessKey), transport: http() });
}

/**
 * Server-side writer, e.g. the Numa conversion writer wallet. Returns a Rabdi-safe writer (serialized,
 * explicit nonce/gas/gasPrice, cost cap). Browser wallets build one with createSafeWriter(wallet, reader, address).
 */
export function createArkivWriter(opts: { account: Account & { address: Address }; accessKey?: string; transport?: Transport } & SafeWriterOptions): SafeWriter {
  const chain = arkivChain(opts.accessKey);
  const transport = opts.transport ?? http();
  const wallet = createWalletClient({ chain, transport, account: opts.account });
  const reader = createPublicClient({ chain, transport });
  return createSafeWriter(wallet, reader, opts.account.address, { ...(opts.gas !== undefined && { gas: opts.gas }), ...(opts.maxCostWei !== undefined && { maxCostWei: opts.maxCostWei }) });
}

export type ArkivReader = ReturnType<typeof createArkivReader>;
export type ArkivWriter = SafeWriter;
