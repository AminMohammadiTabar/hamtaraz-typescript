import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ReconciliationService } from '../application/reconciliation-service.ts';
import type { ReconciliationRun } from '../application/reconciliation-service.ts';
import { DiscrepancyType, Mode, Status } from '../domain/models.ts';
import type { Discrepancy } from '../domain/models.ts';
import { writeReport } from '../infrastructure/excel/report-writer.ts';
import { ExcelParseError } from '../infrastructure/excel/parser.ts';
import { NormalizationError } from '../normalization/normalizer.ts';

/** Public v1 policy: both legacy features remain in source, never exposed. */
export const RELEASE_POLICY = Object.freeze({ enhancedOnly: true, identitySettingsEnabled: false });
const MAX_FILE = 25 * 1024 * 1024;
const MAX_UPLOAD = 2 * MAX_FILE + 1 * 1024 * 1024;
const TIMEOUT = 12 * 3600 * 1000;
// Always start from project root (npm start / npm run start:build).
const ROOT = path.resolve(process.env.HAMTARAZ_ROOT ?? process.cwd());
const sessions = new Map<string, {run: ReconciliationRun | null; csrf: string; accessedAt: number}>();
const service = new ReconciliationService();
const format = (v: bigint | number): string => new Intl.NumberFormat('en-US').format(v);
const signed = (v: bigint | number): string => (v > 0 ? '+' : '') + format(v);
const reasonLabels: Record<string,string> = {
  NO_TBS_COUNTERPART:'فاقد متناظر در گزارش TBS', NO_BANK_COUNTERPART:'فاقد متناظر در گزارش بانک',
  AMBIGUOUS_DUPLICATE_GROUP:'گروه تکراری؛ ردیف دقیق قابل تشخیص نیست',
  ABOVE_AGGREGATE_AMOUNT_DIFFERENCE_LIMIT:'مبلغ بالاتر از سقف اختلاف؛ بررسی هویتی انجام نشد',
  INSUFFICIENT_EVIDENCE:'شواهد کافی برای تعیین وضعیت وجود ندارد'
};
function rowView(d: Discrepancy): Record<string, string> {
  const t = d.transaction;
  return {
    source: t.source === 'BANK_MELLI' ? 'بانک ملی' : 'TBS', row: String(t.excelRowNumber),
    date: t.rawColumns[t.source === 'BANK_MELLI' ? 'تاریخ' : 'تاریخ سند'] ?? t.date,
    sheet: t.sheetName, amount: format(t.amountRials), tracking: t.trackingNumber ?? '—',
    type: d.type === 'BANK_ONLY' ? 'فقط در بانک' : d.type === 'TBS_ONLY' ? 'فقط در TBS' : 'نامشخص',
    reason: reasonLabels[d.reasonCode] ?? d.reasonCode,
    statusClass: d.type === 'BANK_ONLY' ? 'bank' : d.type === 'TBS_ONLY' ? 'tbs' : 'unresolved'
  };
}
function viewResult(run: ReconciliationRun | null, query: URLSearchParams): Record<string,unknown> {
  if (!run) return {hasRun: false};
  const r = run.result, s = r.summary;
  const type = query.get('type')?.toUpperCase() ?? 'ALL';
  const filter = ['BANK_ONLY','TBS_ONLY','UNRESOLVED'].includes(type) ? type : 'ALL';
  const filtered = filter === 'ALL' ? r.discrepancies : r.discrepancies.filter(d => d.type === filter);
  const totalPages = Math.max(1, Math.ceil(filtered.length / 50));
  const requestedPage = Number(query.get('page') ?? '1');
  const page = Number.isFinite(requestedPage) ? Math.max(1, Math.min(totalPages,Math.trunc(requestedPage))) : 1;
  const start = (page-1)*50, end = Math.min(start+50,filtered.length);
  return { hasRun: true, modeLabel: 'تقویت‌شده', bankFilename: run.bankFilename, tbsFilename: run.tbsFilename,
    bankCount: format(s.bankCount), tbsCount: format(s.tbsCount), countDifference: signed(s.countDifference),
    bankTotal: format(s.bankTotalRials), tbsTotal: format(s.tbsTotalRials), amountDifference: signed(s.amountDifferenceRials),
    identityCalls: format(r.identityApiCallCount), bankOnlyCount: r.discrepancies.filter(d=>d.type === DiscrepancyType.BANK_ONLY).length,
    tbsOnlyCount: r.discrepancies.filter(d=>d.type === DiscrepancyType.TBS_ONLY).length,
    unresolvedCount: r.discrepancies.filter(d=>d.type === DiscrepancyType.UNRESOLVED).length,
    balanced: r.status === Status.BALANCED, needsReview: r.status === Status.REVIEW,
    statusText: r.status === Status.BALANCED ? 'بدون مغایرت در کنترل تجمیعی'
      : r.status === Status.FOUND ? 'مغایرت شناسایی‌شده' : 'نیازمند بررسی بیشتر',
    rows: filtered.slice(start,end).map(rowView), hasRows: filtered.length > 0, totalRows: format(filtered.length),
    pageFrom: filtered.length ? format(start+1) : '۰', pageTo: filtered.length ? format(end) : '۰',
    currentPage: page, totalPages,
    previousUrl: `/results?type=${filter}&page=${page-1}`,
    nextUrl: `/results?type=${filter}&page=${page+1}`,
    hasPrevious: page > 1, hasNext: page < totalPages,
    filterAll: filter === 'ALL', filterBank: filter === 'BANK_ONLY',filterTbs: filter === 'TBS_ONLY',
    filterUnresolved: filter === 'UNRESOLVED'
  };
}
async function render(file: string, data: Record<string,unknown>): Promise<string> {
  // @ts-ignore -- Mustache installed by npm
  const {default: Mustache} = await import('mustache');
  const template = await readFile(path.join(ROOT, 'views', `${file}.mustache`), 'utf8');
  return Mustache.render(template, data) as string;
}
function page(res: http.ServerResponse, body: string, code = 200): void {
  res.writeHead(code, { 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'",
    'X-Content-Type-Options':'nosniff', 'X-Frame-Options':'DENY', 'Referrer-Policy':'no-referrer' }); res.end(body);
}
function redirect(res: http.ServerResponse, where: string): void { res.writeHead(303, {Location:where,'Cache-Control':'no-store'});res.end(); }
async function bodyBuffer(req: http.IncomingMessage): Promise<Buffer> {
  const parts: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_UPLOAD) throw new Error('UPLOAD_TOO_LARGE');
    parts.push(bytes);
  }
  return Buffer.concat(parts);
}
function uploadField(value: FormDataEntryValue | null, field: string): {buffer: Promise<Buffer>; name:string} {
  if (!value || typeof value === 'string' || typeof value.arrayBuffer !== 'function' || !value.name.toLowerCase().endsWith('.xlsx') || value.size > MAX_FILE || value.size <= 0)
    throw new Error(`فایل ${field} نامعتبر است؛ فقط فایل xlsx تا ۲۵ مگابایت مجاز است.`);
  return {buffer: value.arrayBuffer().then(b=>Buffer.from(b)), name: value.name.slice(0,220)};
}
function getSession(req: http.IncomingMessage, res:http.ServerResponse): {run:ReconciliationRun|null;csrf:string;accessedAt:number} {
  const cookie = req.headers.cookie?.match(/(?:^|;\s*)hamtaraz_sid=([a-f0-9]{64})(?:;|$)/)?.[1];
  let session = cookie ? sessions.get(cookie) : undefined;
  if (session && Date.now() - session.accessedAt > TIMEOUT) {sessions.delete(cookie!);session=undefined;}
  if (!session) {
    const sid = randomBytes(32).toString('hex'); session={run:null,csrf:randomBytes(24).toString('hex'),accessedAt:Date.now()};
    sessions.set(sid,session);
    res.setHeader('Set-Cookie',`hamtaraz_sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${TIMEOUT/1000}${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`);
  }
  session.accessedAt = Date.now(); return session;
}
function errorMessage(e: unknown): string {
  if (e instanceof ExcelParseError) return `خطای Excel [${e.code}]${e.sheetName ? `، شیت ${e.sheetName}` : ''}${e.excelRowNumber ? '، ردیف '+e.excelRowNumber : ''}: ${e.message}`;
  if (e instanceof NormalizationError) return `خطای نرمال‌سازی [${e.code}]، ردیف ${e.sourceRow.excelRowNumber}: ${e.message}`;
  if (e instanceof Error) return e.message.startsWith('UPLOAD_TOO_LARGE') ? 'حجم فایل‌ها از محدودیت مجاز بیشتر است.' : e.message;
  return 'خطای ناشناخته هنگام پردازش فایل‌ها';
}
/** Minimal native Node HTTP adapter; public v1 exposes only two HTML pages and download. */
export function createHamtarazServer(): http.Server {
  return http.createServer(async (req,res) => {
    const session = getSession(req,res);
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      // Diagnostic endpoint makes local font installation failures observable
      // without exposing the absolute filesystem path to the browser.
      if (req.method === 'GET' && url.pathname === '/diagnostics/font') {
        const fontPath = path.join(ROOT, 'public', 'assets', 'fonts', 'BLOTUS.TTF');
        try {
          const font = await readFile(fontPath);
          const signature = font.subarray(0, 4).toString('hex').toLowerCase();
          const validSfntSignature = ['00010000', '4f54544f', '74727565', '74797031'].includes(signature);
          const payload = JSON.stringify({
            available: true,
            bytes: font.byteLength,
            signature,
            validSfntSignature,
            contentType: 'font/ttf',
            url: '/assets/fonts/BLOTUS.TTF'
          });
          res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
            'X-Content-Type-Options':'nosniff'});
          res.end(payload);
        } catch {
          res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
            'X-Content-Type-Options':'nosniff'});
          res.end(JSON.stringify({available:false,expectedRelativePath:'public/assets/fonts/BLOTUS.TTF',
            url:'/assets/fonts/BLOTUS.TTF',message:'B Lotus font file was not found.'}));
        }
        return;
      }
      if (req.method === 'GET' && ['/assets/styles.css','/assets/app.js'].includes(url.pathname)) {
        const assetPath = path.join(ROOT, 'public', 'assets', path.basename(url.pathname));
        const contentType = url.pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8';
        try {
          const asset = await readFile(assetPath);
          res.writeHead(200, {'Content-Type':contentType,'Content-Length':asset.byteLength,
            'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
          res.end(asset);
        } catch {
          res.writeHead(404, {'Cache-Control':'no-store'});
          res.end();
        }
        return;
      }
      if (req.method === 'GET' && url.pathname === '/assets/fonts/BLOTUS.TTF') {
        const fontPath = path.join(ROOT, 'public', 'assets', 'fonts', 'BLOTUS.TTF');
        try {
          const font = await readFile(fontPath);
          const signature = font.subarray(0, 4).toString('hex').toLowerCase();
          if (!['00010000', '4f54544f', '74727565', '74797031'].includes(signature)) {
            console.error('[hamtaraz][font] The BLOTUS.TTF file does not have a recognized TrueType/OpenType signature.');
            res.writeHead(415, {'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});
            res.end('Invalid TrueType/OpenType font file.');
            return;
          }
          res.writeHead(200, {'Content-Type':'font/ttf','Content-Length':font.byteLength,
            'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
            'Cross-Origin-Resource-Policy':'same-origin'});
          res.end(font);
        } catch {
          console.warn('[hamtaraz][font] B Lotus font not found. Expected: public/assets/fonts/BLOTUS.TTF');
          res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});
          res.end('B Lotus font not found. See /diagnostics/font.');
        }
        return;
      }
      if (req.method === 'GET' && url.pathname === '/') { page(res, await render('index',{csrfToken:session.csrf}));return; }
      if (req.method === 'POST' && url.pathname === '/reconcile') {
        const contentType = req.headers['content-type'] ?? '';
        if (!/^multipart\/form-data\s*;/i.test(contentType))
          throw new Error('درخواست بارگذاری معتبر نیست؛ لطفاً صفحه را تازه‌سازی و دوباره تلاش کنید.');
        const body = await bodyBuffer(req);
        const request = new Request('http://localhost/reconcile', { method:'POST', headers:{'content-type':contentType},body });
        const form = await request.formData();
        if (form.get('csrf') !== session.csrf) {page(res,'Invalid CSRF token',403);return;}
        session.run = null;
        const bank = uploadField(form.get('bankFile'),'بانک ملی');
        const tbs = uploadField(form.get('tbsFile'),'TBS');
        const [bankBytes,tbsBytes] = await Promise.all([bank.buffer,tbs.buffer]);
        if (bankBytes.toString('hex',0,2) !== '504b' || tbsBytes.toString('hex',0,2) !== '504b') throw new Error('فرمت فایل XLSX معتبر نیست.');
        // Server-enforced ENHANCED: ignore any attacker-supplied mode parameter.
        const prepared = await service.prepare(bankBytes,tbsBytes,Mode.ENHANCED,bank.name,tbs.name);
        session.run=prepared.localRun;
        redirect(res,'/results');return;
      }
      if (req.method === 'GET' && url.pathname === '/results') {
        page(res,await render('results',viewResult(session.run,url.searchParams)));return;
      }
      if (req.method === 'GET' && url.pathname === '/results/download') {
        if (!session.run) {res.writeHead(404);res.end('No report');return;}
        const data=await writeReport(session.run.result);
        res.writeHead(200, {'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition':'attachment; filename="hamtaraz-report.xlsx"','Cache-Control':'no-store',
          'Content-Length':data.byteLength});res.end(data);return;
      }
      // Legacy routes /settings and /reconcile/confirm are intentionally NOT mounted in v1.
      res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('Not found');
    } catch (e) {
      // Keep server-side diagnostics useful without logging uploaded file contents.
      console.error('[hamtaraz] Request failed:', e);
      if (req.method === 'POST' && req.url?.startsWith('/reconcile')) page(res, await render('index',{error:errorMessage(e),csrfToken:session.csrf}),400);
      else page(res, 'درخواست با خطا مواجه شد.',500);
    }
  });
}
