/// Deployed contract addresses, keyed by chain ID. Filled in by Member 1 after each testnet
/// deployment (see packages/contracts/script/Deploy.s.sol). Do not hand-edit without a matching
/// verified deployment — see docs/WHITECHAIN.md and docs/PROJECT_STATUS.md.
export const WHITECHAIN_SEPOLIA_CHAIN_ID = 1874;

export type DeployedAddresses = {
  campaignRegistry: `0x${string}`;
  numaRouter: `0x${string}`;
  usdt: `0x${string}`;
};

export const USDT_ADDRESS: `0x${string}` = "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7";

/// Whitechain Sepolia deployment reported by Member 1 (explorer-verified, router: 0.5% fee, 60 s refund window).
/// Keep in sync with .env.example's CAMPAIGN_REGISTRY_ADDRESS / NUMA_ROUTER_ADDRESS.
export const DEPLOYED_ADDRESSES: Partial<Record<number, DeployedAddresses>> = {
  [WHITECHAIN_SEPOLIA_CHAIN_ID]: {
    campaignRegistry: "0xD924385D22626dB2894D25b5f12253BC36148425",
    numaRouter: "0x51fCf8F50ABB17a0d4D70BA14B4F6394A583c2Fc",
    usdt: USDT_ADDRESS,
  },
};
