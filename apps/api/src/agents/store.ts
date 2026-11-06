import type pg from "pg";
import type { Address } from "viem";
import type { Policy, Role } from "./policy.js";

export interface PolicyStore {
  get(principal: Address, role: Role): Promise<Policy | undefined>;
  upsert(p: Policy): Promise<void>;
  listEnabled(): Promise<Policy[]>;
}

const k = (a: string, r: Role) => `${a.toLowerCase()}:${r}`;

export class MemoryPolicyStore implements PolicyStore {
  private m = new Map<string, Policy>();
  async get(a: Address, r: Role) { return this.m.get(k(a, r)); }
  async upsert(p: Policy) { this.m.set(k(p.principal, p.role), p); }
  async listEnabled() { return [...this.m.values()].filter((p) => p.enabled); }
}

export class PgPolicyStore implements PolicyStore {
  constructor(private readonly pool: pg.Pool) {}
  private row(r: Record<string, unknown>): Policy {
    return {
      principal: r.principal as Address, role: r.role as Role, enabled: r.enabled as boolean, limitBps: r.limit_bps as number, openingBps: r.opening_bps as number,
      autoAcceptBps: r.auto_accept_bps as number, stepBps: r.step_bps as number, maxRounds: r.max_rounds as number, categories: r.categories as string[],
    };
  }
  async get(a: Address, r: Role) {
    const res = await this.pool.query("SELECT * FROM agent_policies WHERE principal = $1 AND role = $2", [a.toLowerCase(), r]);
    return res.rows[0] ? this.row(res.rows[0]) : undefined;
  }
  async upsert(p: Policy) {
    await this.pool.query(
      `INSERT INTO agent_policies (principal, role, enabled, limit_bps, opening_bps, auto_accept_bps, step_bps, max_rounds, categories, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
       ON CONFLICT (principal, role) DO UPDATE SET enabled=$3, limit_bps=$4, opening_bps=$5, auto_accept_bps=$6, step_bps=$7, max_rounds=$8, categories=$9, updated_at=now()`,
      [p.principal.toLowerCase(), p.role, p.enabled, p.limitBps, p.openingBps, p.autoAcceptBps, p.stepBps, p.maxRounds, p.categories],
    );
  }
  async listEnabled() {
    const res = await this.pool.query("SELECT * FROM agent_policies WHERE enabled");
    return res.rows.map((r) => this.row(r));
  }
}
