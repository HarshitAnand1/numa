import type { Address, Hex } from "viem";
import type { AgentRole } from "@numa/shared";
import { ArkivWriteError, onArkiv, writerFor, type ArkivStep } from "../web3/arkivWallet";

/**
 * Binding an agent wallet to your identity is an Arkiv transaction signed by YOUR wallet; revoking is
 * another one (delete the entity). The network handling and error mapping live in `web3/arkivWallet`.
 */

export { ArkivWriteError as BindingError };
export type BindStep = ArkivStep;

/** Authorize `agent` to negotiate for `address` in `role` (30 days). Returns the new binding's entity key. */
export function bindAgent(a: { address: Address; agent: Address; role: AgentRole; onStep?: (s: BindStep) => void }) {
  return onArkiv(a.onStep ?? (() => undefined), (arkiv, p) =>
    arkiv.publishAgentBinding(writerFor(arkiv, p, a.address), { agent: a.agent, role: a.role }),
  );
}

/** Delete a binding you own. */
export function revokeBinding(a: { address: Address; entityKey: string; onStep?: (s: BindStep) => void }) {
  return onArkiv(a.onStep ?? (() => undefined), async (arkiv, p) => {
    await writerFor(arkiv, p, a.address).deleteEntity({ entityKey: a.entityKey as Hex });
  });
}
