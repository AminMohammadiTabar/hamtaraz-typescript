/**
 * Port of the four-field legacy identity configuration. This is retained in
 * source but the v1 public server does NOT expose settings/consent routes.
 * Text is parsed as a restricted HTTP template; it is NEVER run in a shell.
 */
export interface IdentityConfiguration {
  curl: string;
  sampleResponseJson: string;
  nationalIdRequestField: string;
  lastNameResponsePath: string;
}
export interface ApprovedIdentityTemplate {
  method: 'GET' | 'POST'; url: string; headers: Record<string,string>;
  body: Record<string,unknown> | null; requestField: string; responsePath: string;
}
const PATH = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/;
const HEADER = /^[A-Za-z0-9-]+$/;
export function jsonAtPath(obj: unknown, path: string): unknown {
  let value: unknown = obj;
  for (const key of path.split('.')) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    value = (value as Record<string,unknown>)[key];
  }
  return value;
}
/** Minimal shell tokenizer for cURL quoting, not a shell command evaluator. */
export function tokenizeCurl(raw: string): string[] {
  if (!raw?.trim() || raw.length > 24000) throw new Error('Empty/oversized cURL template');
  const out: string[] = []; let active = false, quote = '', escaping = false, current = '';
  for (const ch of raw) {
    if (escaping) { if (ch !== '\n' && ch !== '\r') { current += ch; active = true; } escaping = false; continue; }
    if (ch === '\\' && quote !== "'") { escaping = true; continue; }
    if (quote) { if (ch === quote) quote = ''; else current += ch; active = true; continue; }
    if (ch === '"' || ch === "'") { quote = ch; active = true; continue; }
    if (/\s/.test(ch)) { if (active) out.push(current); active = false; current = ''; continue; }
    if (';|><`$'.includes(ch)) throw new Error('Shell metacharacters are not allowed outside quotes');
    current += ch; active = true;
  }
  if (escaping || quote) throw new Error('Unclosed quote/escape');
  if (active) out.push(current);
  return out;
}
export function approveIdentityTemplate(cfg: IdentityConfiguration, allowedHosts: readonly string[]): ApprovedIdentityTemplate {
  const args = tokenizeCurl(cfg.curl);
  if (args.shift()?.toLowerCase() !== 'curl') throw new Error('Template must begin with curl');
  let method: 'GET' | 'POST' = 'GET', rawUrl: string | undefined, rawBody: string | undefined;
  const headers: Record<string,string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '-X' || a === '--request') {
      const v = args[++i]?.toUpperCase();
      if (v !== 'GET' && v !== 'POST') throw new Error('Only GET/POST are supported');
      method = v;
    } else if (a === '-H' || a === '--header') {
      const h = args[++i] ?? '', at = h.indexOf(':');
      const key = h.slice(0, at);
      if (at < 1 || !HEADER.test(key)) throw new Error('Invalid HTTP header');
      if (['host','content-length','connection','transfer-encoding'].includes(key.toLowerCase())) throw new Error('Forbidden header');
      const value = h.slice(at+1).trim();
      if (/[\r\n]/.test(value)) throw new Error('Invalid header value');
      headers[key] = value;
    } else if (['-d','--data','--data-raw'].includes(a)) {
      rawBody = args[++i]; if (method === 'GET') method = 'POST';
    } else if (a === '--url') rawUrl = args[++i];
    else if (a.startsWith('https://')) rawUrl = a;
    else throw new Error(`Unsupported cURL option: ${a}`);
  }
  if (!rawUrl) throw new Error('Missing HTTPS URL');
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash || !allowedHosts.some(x=>x.toLowerCase()===parsed.hostname.toLowerCase()))
    throw new Error('HTTPS hostname not allowed');
  if (!PATH.test(cfg.nationalIdRequestField) || !PATH.test(cfg.lastNameResponsePath)) throw new Error('Invalid field path');
  const sample = JSON.parse(cfg.sampleResponseJson) as unknown;
  if (typeof jsonAtPath(sample, cfg.lastNameResponsePath) !== 'string') throw new Error('Missing string surname in sample response');
  if (method === 'POST' && rawBody === undefined) throw new Error('POST requires JSON body');
  if (method === 'GET' && rawBody !== undefined) throw new Error('GET cannot include body');
  let body: Record<string,unknown> | null = null;
  if (rawBody !== undefined) {
    const obj = JSON.parse(rawBody) as unknown;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Body must be a JSON object');
    body = obj as Record<string,unknown>;
  }
  return { method, url: parsed.toString(), headers, body, requestField: cfg.nationalIdRequestField, responsePath: cfg.lastNameResponsePath };
}
export function injectNationalId(template: ApprovedIdentityTemplate, nationalId: string): { url: string; body: string | undefined } {
  if (!/^\d{10}$/.test(nationalId)) throw new Error('Invalid 10-digit national ID');
  if (template.method === 'GET') {
    const url = new URL(template.url); url.searchParams.set(template.requestField, nationalId);
    return { url: url.toString(), body: undefined };
  }
  const payload = structuredClone(template.body ?? {});
  const path = template.requestField.replace(/^body\./, '').split('.');
  let obj: Record<string,unknown> = payload;
  for (const part of path.slice(0,-1)) {
    const next = obj[part];
    if (!next || typeof next !== 'object' || Array.isArray(next)) obj[part] = {};
    obj = obj[part] as Record<string,unknown>;
  }
  obj[path.at(-1)!] = nationalId;
  return { url: template.url, body: JSON.stringify(payload) };
}
