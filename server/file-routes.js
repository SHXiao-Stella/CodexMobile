import { readBody, sendJson } from './http-utils.js';
import { searchProjectFiles as defaultSearchProjectFiles } from './file-search.js';
import {
  cleanupUploadCache as defaultCleanupUploadCache,
  saveUpload as defaultSaveUpload
} from './upload-service.js';

export function createFileRouteHandler({
  getProject,
  searchProjectFiles = defaultSearchProjectFiles,
  staticService,
  saveUpload = defaultSaveUpload,
  cleanupUploadCache = defaultCleanupUploadCache,
  uploadRoot,
  maxUploadBytes,
  uploadCleanupIntervalMs = 60 * 60 * 1000,
  remoteAddress = () => ''
}) {
  if (!getProject || !staticService) {
    throw new Error('createFileRouteHandler requires getProject and staticService');
  }
  let lastUploadCleanupAt = 0;
  let uploadCleanupRunning = false;

  function scheduleUploadCleanup() {
    if (!cleanupUploadCache || uploadCleanupRunning) {
      return;
    }
    const now = Date.now();
    if (uploadCleanupIntervalMs > 0 && now - lastUploadCleanupAt < uploadCleanupIntervalMs) {
      return;
    }
    lastUploadCleanupAt = now;
    uploadCleanupRunning = true;
    Promise.resolve()
      .then(() => cleanupUploadCache({ uploadRoot }))
      .then((summary) => {
        if (summary?.deletedFiles) {
          console.log(`[upload] cleanup deleted=${summary.deletedFiles} kept=${summary.keptFiles || 0}`);
        }
      })
      .catch((error) => {
        console.warn('[upload] cleanup failed:', error.message);
      })
      .finally(() => {
        uploadCleanupRunning = false;
      });
  }

  return async function handleFileApi(req, res, url) {
    const method = req.method || 'GET';
    const pathname = url.pathname;
    const localFileRoute = pathname === '/api/local-file' || pathname.startsWith('/api/local-file/');

    if (method === 'GET' && pathname === '/api/local-image') {
      await staticService.sendLocalImage(req, res, url);
      return true;
    }

    if (method === 'GET' && localFileRoute) {
      await staticService.sendLocalFile(req, res, url);
      return true;
    }

    if (method === 'PUT' && localFileRoute) {
      try {
        const body = await readBody(req, { maxBytes: 6 * 1024 * 1024 });
        await staticService.writeLocalFile(req, res, url, body);
      } catch (error) {
        sendJson(res, error.message === 'Request body too large' ? 413 : 400, { error: error.message || 'Invalid request body' });
      }
      return true;
    }

    if (method === 'GET' && pathname === '/api/files/search') {
      const project = getProject(url.searchParams.get('projectId') || '');
      if (!project) {
        sendJson(res, 404, { error: 'Project not found' });
        return true;
      }
      try {
        const files = await searchProjectFiles(project, url.searchParams.get('q') || '');
        sendJson(res, 200, { files });
      } catch (error) {
        sendJson(res, error.statusCode || 500, { error: error.message || 'Failed to search files' });
      }
      return true;
    }

    if (method === 'POST' && pathname === '/api/uploads') {
      const upload = await saveUpload(req, { uploadRoot, maxUploadBytes });
      console.log(`[upload] saved name=${upload.name} size=${upload.size} kind=${upload.kind} remote=${remoteAddress(req)}`);
      sendJson(res, 200, { upload });
      scheduleUploadCleanup();
      return true;
    }

    return false;
  };
}
