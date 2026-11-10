import type { IdentityPacingConfig } from '../application/identity-workflow.ts';
/** Optional future identity controls; v1 UI and routes remain disabled. */
function seconds(name:string, fallback:number, min:number, max:number):number {
 const text=process.env[name];if(!text) return fallback;
 const n=Number(text);if(!Number.isInteger(n)||n<min||n>max) throw new Error(`Invalid ${name}`);
 return n;
}
export function identityConfig(): IdentityPacingConfig & {allowedHosts: string[]} {
 return {intervalSeconds:seconds('IDENTITY_INTERVAL_SECONDS',10,0,86400),
  connectTimeoutSeconds:seconds('IDENTITY_CONNECT_TIMEOUT_SECONDS',5,1,300),
  readTimeoutSeconds:seconds('IDENTITY_READ_TIMEOUT_SECONDS',10,1,300),
  allowedHosts:(process.env.IDENTITY_ALLOWED_HOSTS??'').split(',').map(x=>x.trim()).filter(Boolean)};
}
