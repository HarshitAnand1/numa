# ADR 0002 — Settlement is the proof of conversion
**Status: Accepted (from the brief).** A conversion is a settled USDT payment through `NumaRouter`. No Stripe, no webhooks, no verifier/oracle signatures, no campaign escrow. The merchant's EIP-712 order authorizes a price and creator; the buyer's EIP-3009 authorization moves the money.
