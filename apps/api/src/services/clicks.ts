import { createHash } from "node:crypto";

export interface ClickStats { clicks: number; uniqueVisitors: number }

export interface ClickStore {
  record(code: string, visitor: string): Promise<void>;
  stats(code: string): Promise<ClickStats>;
}

export class MemoryClickStore implements ClickStore {
  private rows = new Map<string, string[]>();
  async record(code: string, visitor: string) { (this.rows.get(code) ?? this.rows.set(code, []).get(code)!).push(visitor); }
  async stats(code: string) { const v = this.rows.get(code) ?? []; return { clicks: v.length, uniqueVisitors: new Set(v).size }; }
}

/** Privacy: a salted, truncated hash. The salt rotates daily so visitors cannot be tracked across days. */
export function visitorHash(ip: string, userAgent: string, day: string, secret: string): string {
  return createHash("sha256").update(`${secret}|${day}|${ip}|${userAgent}`).digest("hex").slice(0, 16);
}
