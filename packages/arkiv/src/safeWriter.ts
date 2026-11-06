import type { createWalletClient } from "@arkiv-network/sdk";
import { parseEther, type Address, type Client } from "viem";
import { getBalance, getChainId, getGasPrice, getTransactionCount } from "viem/actions";

export const RABDI_CHAIN_ID = 7794095;
type Wallet = ReturnType<typeof createWalletClient>;

export interface SafeWriterOptions {
  /** Gas for one operation. Rabdi's default estimation can run out of gas; guidance floor is 1,000,000. */
  gas?: bigint;
  /** Refuse any single tx whose gas * gasPrice exceeds this (wei of tGLM). Default 0.05 tGLM. */
  maxCostWei?: bigint;
}

/** Same write surface as the SDK wallet client, with Rabdi-safe transaction parameters injected. */
export interface SafeWriter {
  address: Address;
  createEntity: Wallet["createEntity"];
  patchEntity: Wallet["patchEntity"];
  extendEntity: Wallet["extendEntity"];
  deleteEntity: Wallet["deleteEntity"];
}

/**
 * Wraps an SDK wallet client so every write follows Arkiv's Rabdi write-safety rules
 * (.agents/skills/arkiv-write-safety, arkiv-first-write):
 *  - writes for one account are strictly serialized (no nonce collisions),
 *  - chain id is verified as Rabdi (7794095) before the first write,
 *  - latest and pending nonce must agree (otherwise reconcile before sending),
 *  - explicit nonce, current gasPrice and a gas floor are always passed,
 *  - gas * gasPrice must fit both the configured cap and the account balance.
 * A caller-supplied txParams argument is ignored. No automatic retry: an uncertain write must be reconciled.
 * Not covered: unsigned pre-estimation for large payloads (use ≥2x measured gas for big bytes).
 */
export function createSafeWriter(wallet: Wallet, reader: Client, address: Address, opts: SafeWriterOptions = {}): SafeWriter {
  const gas = opts.gas ?? 1_000_000n;
  const maxCost = opts.maxCostWei ?? parseEther("0.05");
  let chain: Promise<void> | undefined;
  let tail: Promise<unknown> = Promise.resolve();

  const params = async () => {
    chain ??= getChainId(reader).then((id) => { if (id !== RABDI_CHAIN_ID) { chain = undefined; throw new Error(`Wrong chain ${id}; expected Rabdi ${RABDI_CHAIN_ID}`); } });
    await chain;
    const latest = await getTransactionCount(reader, { address, blockTag: "latest" });
    const pending = await getTransactionCount(reader, { address, blockTag: "pending" });
    if (pending !== latest) throw new Error("Pending transaction for this account; reconcile before writing");
    const gasPrice = await getGasPrice(reader);
    const cost = gas * gasPrice;
    if (cost > maxCost) throw new Error(`Gas cap ${cost} wei exceeds configured max ${maxCost}`);
    const balance = await getBalance(reader, { address });
    if (cost > balance) throw new Error("Insufficient tGLM for this write (fund the account at hub.arkiv.network/faucet)");
    return { nonce: latest, gas, gasPrice };
  };

  const run = <T>(send: (p: Awaited<ReturnType<typeof params>>) => Promise<T>): Promise<T> => {
    const next = tail.then(async () => send(await params()));
    tail = next.catch(() => undefined); // a failure must not wedge the queue, and the failed write is never retried
    return next;
  };

  return {
    address,
    createEntity: ((s: never, v: never, o: never) => run((p) => wallet.createEntity(s, v, o, p))) as unknown as Wallet["createEntity"],
    patchEntity: ((s: never, k: never, c: never) => run((p) => wallet.patchEntity(s, k, c, p))) as unknown as Wallet["patchEntity"],
    extendEntity: ((d: never) => run((p) => wallet.extendEntity(d, p))) as unknown as Wallet["extendEntity"],
    deleteEntity: ((d: never) => run((p) => wallet.deleteEntity(d, p))) as unknown as Wallet["deleteEntity"],
  };
}
