const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function fixture(statusCode = 200) {
  const calls = [];
  const exports = {};
  class ApplicationError extends Error { constructor(message, status) { super(message); this.status = status; } }
  const mocks = {
    '@vercel/blob': { get: async (pathname, options) => { calls.push({ pathname, options }); return { statusCode, stream: new Uint8Array([1, 2, 3]) }; } },
    './rider-application-policy': { ApplicationError },
    './local-demo-runtime': { localDemoEnabled: () => false },
    './local-demo-files': {},
  };
  const filename = path.resolve(__dirname, '../src/lib/application-storage.ts');
  new Function('exports', 'require', ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(exports, name => {
    assert(Object.hasOwn(mocks, name), 'Unexpected dependency: ' + name);
    return mocks[name];
  });
  return { read: exports.readApplicationDocument, calls };
}
const base = 'rider-applications/fixture/01234567-89ab-cdef-0123-456789abcdef';

test('PDFs and photos open inline with private, uncached, sandboxed responses', async () => {
  const { read, calls } = fixture();
  for (const [extension, mime] of [['pdf', 'application/pdf'], ['jpg', 'image/jpeg']]) {
    const response = await read('fixture', { pathname: `${base}.${extension}`, mimeType: mime });
    assert.equal(response.headers.get('Content-Disposition'), `inline; filename="application-document.${extension}"`);
    assert.equal(response.headers.get('Content-Type'), mime);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(response.headers.get('Content-Security-Policy'), "default-src 'none'; sandbox");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3]));
  }
  assert(calls.every(call => call.options.access === 'private'));
});

test('preview still rejects another application, invalid paths and missing private files', async () => {
  const { read, calls } = fixture();
  for (const pathname of [base.replace('/fixture/', '/another/') + '.pdf', base + '.html']) {
    await assert.rejects(read('fixture', { pathname, mimeType: 'application/pdf' }), { status: 404 });
  }
  assert.equal(calls.length, 0);
  await assert.rejects(fixture(404).read('fixture', { pathname: base + '.pdf', mimeType: 'application/pdf' }), { status: 404 });
});
