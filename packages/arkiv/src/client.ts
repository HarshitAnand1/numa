import { createPublicClient, createWalletClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { custom, http, numberToHex, type Account, type Address, type EIP1193Provider, type Transport } from "viem";
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

/**
 * Browser-wallet writer: pass the injected EIP-1193 provider (e.g. `window.ethereum`) and the connected address.
 * The wallet only signs and broadcasts; the SafeWriter still supplies an explicit nonce, gas and gasPrice with each request.
 * Reads go through the public Rabdi RPC (optionally with an access key). The wallet must be on Rabdi (see `rabdiAddChainParams`).
 */
export function createArkivBrowserWriter(opts: { provider: EIP1193Provider; address: Address; accessKey?: string } & SafeWriterOptions): SafeWriter {
  const chain = arkivChain(opts.accessKey);
  const wallet = createWalletClient({ chain, transport: custom(opts.provider), account: opts.address });
  const reader = createPublicClient({ chain, transport: http() });
  return createSafeWriter(wallet, reader, opts.address, { ...(opts.gas !== undefined && { gas: opts.gas }), ...(opts.maxCostWei !== undefined && { maxCostWei: opts.maxCostWei }) });
}

/** Parameters for `wallet_addEthereumChain` so a user can add Rabdi (uses the public RPC, never an access key). */
export function rabdiAddChainParams() {
  const c = arkivChain("");
  return {
    chainId: numberToHex(c.id), chainName: c.name, nativeCurrency: c.nativeCurrency,
    rpcUrls: [...c.rpcUrls.default.http], blockExplorerUrls: [c.blockExplorers.default.url],
  };
}

export type ArkivReader = ReturnType<typeof createArkivReader>;
export type ArkivWriter = SafeWriter;
