import { CampaignRegistryAbi } from "@numa/shared";
import { isUserRejection } from "@numa/sdk-react";
import { createPublicClient, createWalletClient, custom, http, parseEventLogs, type Address, type Hex } from "viem";
import { getProvider, switchTo } from "./arkivWallet";
import { CHAIN, CHAIN_ID, RPC_URL } from "./config";

/**
 * The two Whitechain transactions a merchant signs: create a campaign and approve a creator.
 * Plain viem against the injected wallet. Money never moves here (these only write terms/approvals),
 * but they are real, gas-paying (WBT) transactions, so every failure is reported plainly.
 */

export class ChainActionError extends Error {
  constructor(
    readonly code: "NO_WALLET" | "REJECTED" | "REVERTED" | "NO_EVENT" | "FAILED",
    message: string,
  ) {
    super(message);
    this.name = "ChainActionError";
  }
}

const whitechainAddParams = () => ({
  chainId: `0x${CHAIN_ID.toString(16)}`,
  chainName: CHAIN.name,
  nativeCurrency: CHAIN.nativeCurrency,
  rpcUrls: [...CHAIN.rpcUrls.default.http],
  blockExplorerUrls: [CHAIN.blockExplorers.default.url],
});

function classify(e: unknown): ChainActionError {
  if (e instanceof ChainActionError) return e;
  if (isUserRejection(e)) return new ChainActionError("REJECTED", "You declined the transaction. Nothing was sent.");
  const msg = (e as { message?: string; shortMessage?: string })?.shortMessage ?? (e as { message?: string })?.message ?? "";
  if (/insufficient funds/i.test(msg)) return new ChainActionError("FAILED", "Not enough WBT in this wallet to pay for the transaction.");
  if (/reverted|revert/i.test(msg)) return new ChainActionError("REVERTED", "The contract refused this transaction. Nothing changed.");
  console.error("[numa] chain action failed:", e);
  return new ChainActionError("FAILED", "The transaction failed. Nothing changed.");
}

async function send<T>(registry: Address, account: Address, run: (c: ReturnType<typeof clients>) => Promise<T>): Promise<T> {
  let provider;
  try {
    provider = getProvider();
  } catch {
    throw new ChainActionError("NO_WALLET", "No wallet found in this browser.");
  }
  try {
    await switchTo(provider, CHAIN_ID, whitechainAddParams());
    return await run(clients(provider, account));
  } catch (e) {
    throw classify(e);
  }
}

function clients(provider: ReturnType<typeof getProvider>, account: Address) {
  return {
    wallet: createWalletClient({ chain: CHAIN, transport: custom(provider), account }),
    pub: createPublicClient({ chain: CHAIN, transport: http(RPC_URL) }),
    account,
  };
}

/** `createCampaign` on the registry. Waits for the receipt and reads the new id from `CampaignCreated`. */
export function createCampaignTx(a: { registry: Address; account: Address; payoutSigner: Address; commissionBps: number; endsAt: number }) {
  return send(a.registry, a.account, async ({ wallet, pub }) => {
    const hash = await wallet.writeContract({
      address: a.registry,
      abi: CampaignRegistryAbi,
      functionName: "createCampaign",
      args: [a.payoutSigner, BigInt(a.commissionBps), BigInt(a.endsAt)],
      account: a.account,
      chain: CHAIN,
    });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new ChainActionError("REVERTED", "The campaign transaction reverted. Nothing was created.");
    const logs = parseEventLogs({ abi: CampaignRegistryAbi, eventName: "CampaignCreated", logs: receipt.logs }).filter(
      (l) => l.address.toLowerCase() === a.registry.toLowerCase(),
    );
    // the ABI comes from a JSON file, so its event args are untyped: narrow them here
    const id = (logs[0] as unknown as { args?: { campaignId?: bigint } } | undefined)?.args?.campaignId;
    // The transaction succeeded, so the campaign exists: never hide that behind a generic error.
    if (id === undefined) throw new ChainActionError("NO_EVENT", `Created, but the campaign id couldn't be read from the receipt. Find it in transaction ${hash}.`);
    return { txHash: hash as Hex, campaignId: id };
  });
}

/** `approveCreator` on the registry. */
export function approveCreatorTx(a: { registry: Address; account: Address; campaignId: bigint; creator: Address }) {
  return send(a.registry, a.account, async ({ wallet, pub }) => {
    const hash = await wallet.writeContract({
      address: a.registry,
      abi: CampaignRegistryAbi,
      functionName: "approveCreator",
      args: [a.campaignId, a.creator],
      account: a.account,
      chain: CHAIN,
    });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new ChainActionError("REVERTED", "The approval reverted (is this your campaign?). Nothing changed.");
    return { txHash: hash as Hex };
  });
}
