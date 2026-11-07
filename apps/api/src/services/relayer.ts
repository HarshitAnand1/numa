import { recoverTypedDataAddress, type Address, type Hex, type PublicClient, type WalletClient, type Account } from "viem";
import { USDT_ADDRESS, campaignRegistryAbi, computeOrderCommitment, numaRouterAbi, orderTypedData, receiveAuthTypedData, type RelayRequest } from "@numa/shared";
import type { RelayStore } from "./store.js";

export type RelayErrorCode =
  | "ORDER_EXPIRED" | "BAD_AUTH_WINDOW" | "BAD_SELF_PURCHASE" | "BAD_MERCHANT_SIG" | "BAD_BUYER_AUTH" | "DUPLICATE"
  | "GAS_PRICE_TOO_HIGH" | "DAILY_CAP_EXCEEDED" | "ADDRESS_LIMIT_EXCEEDED" | "INSUFFICIENT_RELAYER_BALANCE"
  | "SIMULATION_FAILED" | "TX_REVERTED" | "TX_TIMEOUT";

export class RelayError extends Error {
  constructor(public code: RelayErrorCode, message: string) { super(message); }
}

export interface RelayerConfig {
  router: Address;
  /** CampaignRegistry address - needed to independently fetch `commissionBps` for the
   * OrderCommitment check (see docs/DECISIONS/0005-order-commitment-nonce-binding.md). */
  registry: Address;
  chainId: number;
  maxGasPriceWei: bigint;
  dailyCapWei: bigint;
  perAddressDailyLimit: number;
  /** USDT token whose EIP-712 domain the buyer signs under. Defaults to the verified test USDT. */
  token?: Address;
  receiptTimeoutMs?: number;
}

/** Gas limit = estimate + 25%. Unused gas is refunded, so this only raises the worst-case cost that the daily cap and balance checks use. */
export const withGasBuffer = (estimate: bigint) => estimate + estimate / 4n;

export interface RelayResult { txHash: Hex; blockNumber: bigint; gasCostWei: bigint }

/**
 * Relayer. It can ONLY call payOrder on the configured router: the target and function are
 * fixed here, nothing from the request selects a contract or calldata.
 */
export class Relayer {
  constructor(
    private readonly cfg: RelayerConfig,
    private readonly pub: PublicClient,
    private readonly wallet: WalletClient,
    private readonly account: Account,
    private readonly store: RelayStore,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  private day() { return new Date(this.now() * 1000).toISOString().slice(0, 10); }

  async submit(req: RelayRequest, log: (o: object) => void = () => {}): Promise<RelayResult> {
    const { order, auth } = req;
    const buyer = order.buyer;
    const now = BigInt(this.now());

    // Cheap, local validation first.
    if (order.deadline <= now) throw new RelayError("ORDER_EXPIRED", "order deadline passed");
    if (auth.validAfter > now || auth.validBefore <= now) throw new RelayError("BAD_AUTH_WINDOW", "authorization not currently valid");
    const lower = buyer.toLowerCase();
    if (lower === order.creator.toLowerCase()) throw new RelayError("BAD_SELF_PURCHASE", "buyer cannot be creator");
    if (lower === order.merchant.toLowerCase()) throw new RelayError("BAD_SELF_PURCHASE", "buyer cannot be merchant");

    // Merchant signature must at least be well-formed; the router enforces signer == campaign payout signer.
    try {
      await recoverTypedDataAddress({ ...orderTypedData(order, this.cfg.chainId, this.cfg.router), signature: req.merchantSig });
    } catch { throw new RelayError("BAD_MERCHANT_SIG", "unrecoverable merchant signature"); }

    // Independently fetch the campaign's commissionBps and the router's feeBps - the same values
    // the contract itself reads at settlement time - to recompute the expected OrderCommitment
    // locally. Never trust a caller-supplied authNonce; the relayer always derives it itself.
    const [campaign, feeBps] = await Promise.all([
      this.pub.readContract({ address: this.cfg.registry, abi: campaignRegistryAbi, functionName: "getCampaign", args: [order.campaignId] }),
      this.pub.readContract({ address: this.cfg.router, abi: numaRouterAbi, functionName: "feeBps" }),
    ]);
    const nonce = computeOrderCommitment(
      { campaignId: order.campaignId, merchant: order.merchant, creator: order.creator, buyer: order.buyer, gross: order.gross, commissionBps: campaign.commissionBps, feeBps, orderId: order.orderId, deadline: order.deadline },
      this.cfg.chainId, this.cfg.router,
    );

    // The buyer's EIP-3009 authorization must be exactly for this order: recipient = router, value = gross,
    // nonce = the OrderCommitment just recomputed (never taken from the request). A wrong nonce, amount,
    // recipient or signer recovers to a different address and is rejected before any RPC or gas is spent.
    const authTyped = receiveAuthTypedData(
      { from: buyer, router: this.cfg.router, value: order.gross, validAfter: auth.validAfter, validBefore: auth.validBefore, nonce },
      this.cfg.chainId, this.cfg.token ?? USDT_ADDRESS,
    );
    let authSigner: Address | undefined;
    try { authSigner = await recoverTypedDataAddress({ ...authTyped, signature: { r: auth.r, s: auth.s, v: BigInt(auth.v) } }); } catch { /* falls through */ }
    if (!authSigner || authSigner.toLowerCase() !== lower) throw new RelayError("BAD_BUYER_AUTH", "buyer authorization does not match this order");

    if (!(await this.store.claimOrder(order.orderId, buyer))) throw new RelayError("DUPLICATE", "order already submitted");
    let keepClaim = false;
    try {
      const day = this.day();
      if ((await this.store.countForAddress(day, buyer)) >= this.cfg.perAddressDailyLimit)
        throw new RelayError("ADDRESS_LIMIT_EXCEEDED", "per-address daily limit reached");

      const gasPrice = await this.pub.getGasPrice();
      if (gasPrice > this.cfg.maxGasPriceWei) throw new RelayError("GAS_PRICE_TOO_HIGH", `gas price ${gasPrice} above ceiling`);

      const args = [order, req.merchantSig, auth.validAfter, auth.validBefore, nonce, auth.v, auth.r, auth.s] as const;
      let request;
      try {
        ({ request } = await this.pub.simulateContract({
          address: this.cfg.router, abi: numaRouterAbi, functionName: "payOrder", args, account: this.account,
        }));
      } catch (e) {
        throw new RelayError("SIMULATION_FAILED", e instanceof Error ? e.message.split("\n")[0]! : "simulation failed");
      }

      // An exact estimate can run out of gas by the time the tx is mined: storage costs (zero to non-zero) and the EIP-150
      // 63/64 rule depend on state that other txs (e.g. a keeper release) change in between. Found by the fork rehearsal.
      const gas = withGasBuffer(await this.pub.estimateContractGas({
        address: this.cfg.router, abi: numaRouterAbi, functionName: "payOrder", args, account: this.account,
      }));
      const maxCost = gas * gasPrice;
      if ((await this.store.spentToday(day)) + maxCost > this.cfg.dailyCapWei) throw new RelayError("DAILY_CAP_EXCEEDED", "relayer daily gas cap reached");
      const balance = await this.pub.getBalance({ address: this.account.address });
      if (balance < maxCost) throw new RelayError("INSUFFICIENT_RELAYER_BALANCE", "relayer WBT balance too low");

      const txHash = await this.wallet.writeContract({ ...request, gas, gasPrice } as never);
      keepClaim = true; // a tx is in flight; never auto-retry the same order
      await this.store.markSent(order.orderId, txHash);
      log({ evt: "relay.sent", orderId: order.orderId, txHash });

      let receipt;
      try {
        receipt = await this.pub.waitForTransactionReceipt({ hash: txHash, timeout: this.cfg.receiptTimeoutMs ?? 60_000 });
      } catch { throw new RelayError("TX_TIMEOUT", `no receipt for ${txHash}; check explorer before retrying`); }
      if (receipt.status !== "success") {
        // The receipt proves the order was NOT settled, so the order may be submitted again (by a new request).
        await this.store.markReverted(order.orderId);
        throw new RelayError("TX_REVERTED", `tx ${txHash} reverted`);
      }
      await this.store.markSettled(order.orderId);

      const cost = receipt.gasUsed * receipt.effectiveGasPrice;
      await this.store.addSpend(day, cost);
      await this.store.incrementAddress(day, buyer);
      log({ evt: "relay.settled", orderId: order.orderId, txHash, block: receipt.blockNumber.toString() });
      return { txHash, blockNumber: receipt.blockNumber, gasCostWei: cost };
    } finally {
      if (!keepClaim) await this.store.releaseOrder(order.orderId);
    }
  }
}
