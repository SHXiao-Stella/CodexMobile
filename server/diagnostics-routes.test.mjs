import assert from 'node:assert/strict';
import test from 'node:test';
import { createDiagnosticsRouteHandler } from './diagnostics-routes.js';

function createResponse() {
  return {
    status: null,
    headers: null,
    body: '',
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    }
  };
}

test('diagnostics route serves memory snapshot on protected route handler', async () => {
  const handle = createDiagnosticsRouteHandler({
    getMemoryDiagnostics: () => ({ ok: true, cache: { sessionCount: 3 } })
  });
  const res = createResponse();
  const handled = await handle({ method: 'GET' }, res, new URL('http://local/api/diagnostics/memory'));

  assert.equal(handled, true);
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true, cache: { sessionCount: 3 } });
});

test('diagnostics route ignores unrelated paths', async () => {
  const handle = createDiagnosticsRouteHandler({
    getMemoryDiagnostics: () => ({ ok: true })
  });
  const res = createResponse();
  const handled = await handle({ method: 'GET' }, res, new URL('http://local/api/status'));

  assert.equal(handled, false);
  assert.equal(res.status, null);
});
