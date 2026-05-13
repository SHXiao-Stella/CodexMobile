import { sendJson } from './http-utils.js';

export function createDiagnosticsRouteHandler({
  getMemoryDiagnostics
} = {}) {
  return async function handleDiagnosticsApi(req, res, url) {
    const method = req.method || 'GET';
    const pathname = url.pathname;
    if (method === 'GET' && pathname === '/api/diagnostics/memory') {
      sendJson(res, 200, await getMemoryDiagnostics());
      return true;
    }
    return false;
  };
}
