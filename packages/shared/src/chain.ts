import { defineChain, type Address } from "viem";

export const whitechainSepolia = defineChain({
  id: 1874,
  name: "Whitechain Sepolia",
  nativeCurrency: { name: "WBT", symbol: "WBT", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.whitechain.io"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://explorer.testnet.whitechain.io" } },
});

/** Test USDT (EIP-1967 proxy). Verified on-chain, see docs/WHITECHAIN.md. */
export const USDT_ADDRESS: Address = "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7";
export const USDT_DECIMALS = 6;
/** EIP-712 domain of the token, derived and matched against DOMAIN_SEPARATOR(). */
export const USDT_DOMAIN_NAME = "Tether USD";
export const USDT_DOMAIN_VERSION = "1";
