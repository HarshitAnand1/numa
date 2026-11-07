/// Deployed contract addresses, keyed by chain ID. Filled in by Member 1 after each testnet
/// deployment (see packages/contracts/script/Deploy.s.sol). Do not hand-edit without a matching
/// verified deployment — see docs/WHITECHAIN.md and docs/PROJECT_STATUS.md.
export const WHITECHAIN_SEPOLIA_CHAIN_ID = 1874;

export type DeployedAddresses = {
  campaignRegistry: `0x${string}`;
  numaRouter: `0x${string}`;
  usdt: `0x${string}`;
  /** Block both contracts were deployed in: where indexers and ledger exports start scanning. */
  deploymentBlock: number;
};

export const USDT_ADDRESS: `0x${string}` = "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7";

/// Whitechain Sepolia deployment, reported by Member 1 and checked on-chain on 2026-11-07: both contracts have code, the router's
/// registry() and usdt() match the values below, feeBps = 50 (0.5%), refundWindow = 60s, and the explorer lists both as verified.
/// Both were created in block 12414186 by 0x9dC62Bef98095eB2Bef9C8E9d5432C989115Df39.
/// Keep this in sync with .env.example's CAMPAIGN_REGISTRY_ADDRESS / NUMA_ROUTER_ADDRESS / INDEXER_START_BLOCK.
export const DEPLOYED_ADDRESSES: Partial<Record<number, DeployedAddresses>> = {
  1874: {
    campaignRegistry: "0xD924385D22626dB2894D25b5f12253BC36148425",
    numaRouter: "0x51fCf8F50ABB17a0d4D70BA14B4F6394A583c2Fc",
    usdt: USDT_ADDRESS,
    deploymentBlock: 12414186,
  },
};
