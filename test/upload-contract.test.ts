import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('upload page loads browser client as an ES module', async () => {
  const html = await readFile(new URL('../views/index.mustache', import.meta.url), 'utf8');
  assert.match(html, /<script\s+type="module"\s+src="\/assets\/app\.js"><\/script>/);
  assert.match(html, /enctype="multipart\/form-data"/);
  assert.match(html, /name="bankFile"/);
  assert.match(html, /name="tbsFile"/);
  assert.match(html, /name="csrf"/);
});

test('server accepts XLSX extension case-insensitively and validates multipart requests', async () => {
  const server = await readFile(new URL('../src/web/server.ts', import.meta.url), 'utf8');
  assert.match(server, /value\.name\.toLowerCase\(\)\.endsWith\('\.xlsx'\)/);
  assert.match(server, /multipart\\\/form-data/);
  assert.match(server, /'Cache-Control':'no-store'/);
});

test('Node multipart parser preserves uploaded XLSX file bytes', async () => {
  const http = await import('node:http');
  const expected = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x10, 0x20, 0x30, 0x40]);
  const server = http.createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      const request = new Request('http://localhost/reconcile', {
        method: 'POST',
        headers: { 'content-type': req.headers['content-type'] ?? '' },
        body
      });
      const form = await request.formData();
      const uploaded = form.get('bankFile');
      assert.ok(uploaded && typeof uploaded !== 'string');
      assert.equal(uploaded.name, 'bank.XLSX');
      assert.deepEqual(Buffer.from(await uploaded.arrayBuffer()), expected);
      res.writeHead(204);
      res.end();
    } catch (error) {
      res.writeHead(500);
      res.end(error instanceof Error ? error.message : 'unknown error');
    }
  });
  await new Promise<void>(resolve => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const form = new FormData();
    form.set('bankFile', new Blob([expected]), 'bank.XLSX');
    const response = await fetch(`http://127.0.0.1:${address.port}/reconcile`, { method: 'POST', body: form });
    assert.equal(response.status, 204);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
