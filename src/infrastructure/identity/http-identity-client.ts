import type { IdentityInquiryPort } from '../../domain/models.ts';
import { injectNationalId, jsonAtPath } from './configuration.ts';
import type { ApprovedIdentityTemplate } from './configuration.ts';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import https from 'node:https';
/**
 * Private version-1 source adapter: explicit approval required by the caller,
 * restricted HTTPS destination and redirect refusal. DNS is resolved once per
 * request and bound into https.request.lookup to mitigate rebind/SSRF.
 */
export class HttpIdentityClient implements IdentityInquiryPort {
  constructor(private readonly approved: ApprovedIdentityTemplate,
              private readonly timeoutMs = 15_000) {}
  async findLastName(nationalId: string): Promise<string | null> {
    try {
      const request = injectNationalId(this.approved, nationalId);
      const url = new URL(request.url);
      const addresses = await lookup(url.hostname, { all: true });
      const candidates = addresses.filter(a => publicAddress(a.address));
      if (!candidates.length || candidates.length !== addresses.length) return null;
      const first = candidates[0]!;
      const raw = await new Promise<string | null>((resolve, reject) => {
        const req = https.request(url, { method: this.approved.method, timeout: this.timeoutMs,
          headers: { ...this.approved.headers, ...(this.approved.method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
          lookup: (_host, _opts, callback) => callback(null, first.address, first.family) }, res => {
            if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) { res.resume(); resolve(null); return; }
            const chunks: Buffer[] = []; let length = 0;
            res.on('data', (c: Buffer) => { length += c.length; if (length > 65_536) { req.destroy(); reject(new Error('Response too large')); } else chunks.push(c); });
            res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
            res.on('error', reject);
          });
        req.on('timeout', () => req.destroy(new Error('Identity HTTP timeout')));
        req.on('error', reject);
        if (request.body) req.write(request.body);
        req.end();
      });
      if (!raw) return null;
      const name = jsonAtPath(JSON.parse(raw), this.approved.responsePath);
      return typeof name === 'string' && name.trim() ? name.trim() : null;
    } catch { return null; }
  }
}
function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const a = address.split('.').map(Number);
    return !(a[0] === 0 || a[0] === 10 || a[0] === 127 || a[0] >= 224 ||
      (a[0] === 169 && a[1] === 254) || (a[0] === 172 && a[1] >= 16 && a[1] <= 31) ||
      (a[0] === 192 && a[1] === 168) || (a[0] === 100 && a[1] >= 64 && a[1] <= 127) ||
      (a[0] === 192 && a[1] === 0 && a[2] === 0) || (a[0] === 198 && (a[1] === 18 || a[1] === 19)));
  }
  if (isIP(address) === 6) {
    const s = address.toLowerCase();
    if (s === '::1' || s === '::' || s.startsWith('fe8') || s.startsWith('fe9') || s.startsWith('fea') || s.startsWith('feb') || s.startsWith('fc') || s.startsWith('fd')) return false;
    // IPv4-mapped IPv6 is rejected; do not bypass IPv4 filters.
    if (s.includes('ffff:')) return false;
    return true;
  }
  return false;
}
