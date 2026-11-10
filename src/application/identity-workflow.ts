import type { IdentityInquiryPort } from '../domain/models.ts';
/** Optional, consent-gated future workflow. No public endpoints in v1. */
export interface IdentityPacingConfig { intervalSeconds: number; connectTimeoutSeconds: number; readTimeoutSeconds: number; }
export function estimateLookupTime(count: number, config: IdentityPacingConfig): { minSeconds: number; upperBudgetSeconds: number } {
  if (!Number.isInteger(count) || count < 0 || !Number.isInteger(config.intervalSeconds) || config.intervalSeconds < 0 || config.intervalSeconds > 86_400)
    throw new Error('Invalid pacing parameters');
  const minSeconds = Math.max(0, count - 1) * config.intervalSeconds;
  return { minSeconds, upperBudgetSeconds: minSeconds + count*(config.connectTimeoutSeconds + config.readTimeoutSeconds) };
}
export class PacedIdentityPort implements IdentityInquiryPort {
  private nextStart = 0; attempted = 0; failed = 0;
  constructor(private readonly delegate: IdentityInquiryPort, private readonly intervalMs = 10_000,
              private readonly sleeper: (ms:number)=>Promise<void> = ms => new Promise(ok=>setTimeout(ok,ms))) {
    if (!Number.isFinite(intervalMs) || intervalMs < 0) throw new Error('Invalid identity pacing interval');
  }
  async findLastName(nationalId: string): Promise<string | null> {
    const delay = this.nextStart - Date.now();
    if (delay > 0) await this.sleeper(delay);
    this.nextStart = Date.now() + this.intervalMs;
    this.attempted++;
    try { const result = await this.delegate.findLastName(nationalId); if (!result) this.failed++; return result; }
    catch { this.failed++; return null; }
  }
}
