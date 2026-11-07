import { policyAuthMessage, type AgentRole } from "@numa/shared";

/**
 * The negotiation-agent policy form, as pure functions. The guardrails here mirror
 * `apps/api/src/agents/policy.ts` (parsePolicy) exactly; a test runs both validators on the same
 * inputs so they cannot drift apart. The API re-validates everything: this only saves a round trip
 * and a wallet signature on input that would be refused anyway.
 */

export type { AgentRole };

/** Percent strings, as typed by a person. */
export interface PolicyForm {
  enabled: boolean;
  /** creator: the floor (never accept less); merchant: the ceiling (never pay more) */
  limit: string;
  /** merchant only: the first proposal */
  opening: string;
  /** accept immediately at this rate or better (creator: at or above; merchant: at or below) */
  autoAccept: string;
  /** how far each counter moves */
  step: string;
  maxRounds: string;
  /** merchant only: comma-separated campaign categories (empty = all) */
  categories: string;
}

/** Exactly what the API stores and what the wallet signs (basis points, integers). */
export interface PolicyBody {
  principal: string;
  role: AgentRole;
  enabled: boolean;
  limitBps: number;
  openingBps: number;
  autoAcceptBps: number;
  stepBps: number;
  maxRounds: number;
  categories: string[];
}

export const MAX_BPS = 5000; // the contracts cap commission at 50%
export const CATEGORY = /^[a-z0-9-]{2,32}$/;

export function defaultForm(role: AgentRole): PolicyForm {
  return role === "creator"
    ? { enabled: true, limit: "12", opening: "", autoAccept: "18", step: "1", maxRounds: "5", categories: "" }
    : { enabled: true, limit: "25", opening: "15", autoAccept: "18", step: "1", maxRounds: "5", categories: "" };
}

/** "12.5" -> 1250. At most 2 decimals, no signs, no exponent; null when it is not a plain percent. */
export function pctToBps(s: string): number | null {
  const t = s.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const [whole = "0", frac = ""] = t.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function bpsToPct(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}

export function parseCategories(s: string): string[] {
  return s
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
}

export type FieldErrors = Partial<Record<keyof PolicyForm, string>>;

export function validateForm(
  role: AgentRole,
  f: PolicyForm,
): { ok: true; body: Omit<PolicyBody, "principal"> } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const limit = pctToBps(f.limit);
  const auto = pctToBps(f.autoAccept);
  const step = pctToBps(f.step);
  // the creator's opening position is the offer's own ask, so it is sent as 0 and ignored
  const opening = role === "merchant" ? pctToBps(f.opening) : 0;
  const rounds = /^\d{1,2}$/.test(f.maxRounds.trim()) ? Number(f.maxRounds) : null;
  const cats = role === "merchant" ? parseCategories(f.categories) : [];

  const limitName = role === "creator" ? "floor" : "ceiling";
  if (limit === null) errors.limit = `Enter your ${limitName} as a percent, like 12 or 12.5.`;
  else if (limit > MAX_BPS) errors.limit = "Commission can't exceed 50%.";
  if (auto === null) errors.autoAccept = "Enter a percent, like 18.";
  else if (auto > MAX_BPS) errors.autoAccept = "Commission can't exceed 50%.";
  if (role === "merchant") {
    if (opening === null) errors.opening = "Enter your opening offer as a percent.";
    else if (opening > MAX_BPS) errors.opening = "Commission can't exceed 50%.";
  }
  if (step === null || step < 10 || step > 1000) errors.step = "The step must be between 0.1% and 10%.";
  if (rounds === null || rounds < 1 || rounds > 10) errors.maxRounds = "Use 1 to 10 rounds.";
  if (cats.length > 10) errors.categories = "At most 10 categories.";
  else if (cats.some((c) => !CATEGORY.test(c))) errors.categories = "Categories are lowercase letters, numbers and dashes, 2 to 32 characters.";

  // the same cross-field rules as the server
  if (!errors.limit && !errors.autoAccept && limit !== null && auto !== null) {
    if (role === "creator" && auto < limit) errors.autoAccept = "Auto-accept must be at or above your floor.";
    if (role === "merchant" && auto > limit) errors.autoAccept = "Auto-accept must be at or below your ceiling.";
  }
  if (role === "merchant" && !errors.limit && !errors.opening && limit !== null && opening !== null && opening > limit) {
    errors.opening = "Your opening offer can't be above your ceiling.";
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    body: {
      role,
      enabled: f.enabled,
      limitBps: limit as number,
      openingBps: opening as number,
      autoAcceptBps: auto as number,
      stepBps: step as number,
      maxRounds: rounds as number,
      categories: cats,
    },
  };
}

export function toBody(principal: string, role: AgentRole, f: PolicyForm): PolicyBody | { errors: FieldErrors } {
  const v = validateForm(role, f);
  return v.ok ? { principal, ...v.body } : { errors: v.errors };
}

export function formFromPolicy(p: PolicyBody): PolicyForm {
  return {
    enabled: p.enabled,
    limit: bpsToPct(p.limitBps),
    opening: p.role === "merchant" ? bpsToPct(p.openingBps) : "",
    autoAccept: bpsToPct(p.autoAcceptBps),
    step: bpsToPct(p.stepBps),
    maxRounds: String(p.maxRounds),
    categories: p.categories.join(", "),
  };
}

/**
 * The request the wallet signs. `message` is built with @numa/shared's `policyAuthMessage`, the very
 * function the API verifies with, and shown to the user in the wallet as readable text.
 */
export function writeRequest(body: PolicyBody, issuedAt: number) {
  return { message: policyAuthMessage("write", body.principal, body.role, issuedAt, body), payload: { policy: body, issuedAt } };
}
export function readRequest(principal: string, role: AgentRole, issuedAt: number) {
  return { message: policyAuthMessage("read", principal, role, issuedAt), payload: { principal, role, issuedAt } };
}
