import { describe, expect, it } from "vitest";
import { hashTypedData } from "viem";
import {
  ORDER_COMMITMENT_EIP712_TYPES, ORDER_COMMITMENT_TEST_VECTOR, ORDER_COMMITMENT_TEST_VECTOR_DOMAIN, ORDER_COMMITMENT_TEST_VECTOR_EXPECTED_DIGEST,
} from "../src/index.js";

// The expected digest was cross-checked independently on 2026-11-07: computed with `cast` from the
// typehash string in NumaRouter.sol (ORDER_COMMITMENT_TYPEHASH) and the contract's abi.encode field order.
// If this fails, TypeScript and Solidity no longer agree and every payOrder will revert on the nonce check.
describe("OrderCommitment cross-language vector", () => {
  it("TypeScript EIP-712 digest equals the Solidity-derived digest", () => {
    expect(hashTypedData({
      domain: ORDER_COMMITMENT_TEST_VECTOR_DOMAIN, types: ORDER_COMMITMENT_EIP712_TYPES,
      primaryType: "OrderCommitment", message: ORDER_COMMITMENT_TEST_VECTOR,
    })).toBe(ORDER_COMMITMENT_TEST_VECTOR_EXPECTED_DIGEST);
  });
});
