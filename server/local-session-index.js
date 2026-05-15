import fs from 'node:fs/promises';
import path from 'node:path';
import {
  CODEX_SESSION_INDEX,
  CODEX_SESSIONS_DIR
} from './codex-config.js';

const THREAD_ID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
const FIRST_LINE_READ_LIMIT = 1024 * 1024;
const jsonlMetaCache = new Map();

let lastLocalSessionIndexDiagnostics = {
  startedAt: null,
  completedAt: null,
  durationMs: null,
  visitedFiles: 0,
  jsonlFiles: 0,
  metaCacheHits: 0,
  metaCacheMisses: 0,
  metaCacheSize: 0,
  metaReadFailures: 0,
  lockedFallbackThreads: 0,
  returnedThreads: 0,
  error: null
};

function timestampSeconds(value) {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? ms / 1000 : null;
}

function isMissing(value) {
  return value === undefined || value === null || value === '';
}

function mergeDefined(base = {}, override = {}) {
  const next = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (!isMissing(value)) {
      next[key] = value;
    }
  }
  return next;
}

function threadIdFromFile(filePath) {
  return path.basename(filePath).match(THREAD_ID_RE)?.[1] || null;
}

async function readSessionIndex(indexPath) {
  let text = '';
  try {
    text = await fs.readFile(indexPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return new Map();
    }
    throw error;
  }

  const entries = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const row = JSON.parse(line);
      const id = String(row.id || '').trim();
      if (!id) {
        continue;
      }
      const updatedAtIso = row.updated_at || row.updatedAt || null;
      const existing = entries.get(id);
      if (existing && timestampSeconds(existing.updatedAtIso) > timestampSeconds(updatedAtIso)) {
        continue;
      }
      entries.set(id, {
        id,
        name: row.thread_name || row.threadName || row.name || existing?.name || null,
        updatedAtIso: updatedAtIso || existing?.updatedAtIso || null
      });
    } catch {
      // Corrupt index rows should not hide otherwise readable rollout files.
    }
  }
  return entries;
}

async function walkJsonlFiles(root) {
  const files = [];
  let visitedFiles = 0;
  async function visit(dir) {
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile()) {
        visitedFiles += 1;
        if (entry.name.endsWith('.jsonl') && threadIdFromFile(fullPath)) {
          files.push(fullPath);
        }
      }
    }
  }
  await visit(root);
  return { files, visitedFiles };
}

async function readFirstJsonLine(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const chunks = [];
    let total = 0;
    let position = 0;
    while (total < FIRST_LINE_READ_LIMIT) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, FIRST_LINE_READ_LIMIT - total));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) {
        break;
      }
      const chunk = buffer.subarray(0, bytesRead);
      const newline = chunk.indexOf(10);
      if (newline >= 0) {
        chunks.push(chunk.subarray(0, newline));
        break;
      }
      chunks.push(chunk);
      total += bytesRead;
      position += bytesRead;
    }
    const line = Buffer.concat(chunks).toString('utf8').trim();
    return line ? JSON.parse(line) : null;
  } finally {
    await handle.close();
  }
}

function cacheKey(filePath) {
  return path.resolve(filePath);
}

async function readCachedFirstJsonLine(filePath, stat, diagnostics) {
  const key = cacheKey(filePath);
  const mtimeMs = Number(stat?.mtimeMs || 0);
  const size = Number(stat?.size || 0);
  const cached = jsonlMetaCache.get(key);
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) {
    diagnostics.metaCacheHits += 1;
    return cached.metaRow;
  }
  const metaRow = await readFirstJsonLine(filePath);
  diagnostics.metaCacheMisses += 1;
  jsonlMetaCache.set(key, {
    mtimeMs,
    size,
    metaRow
  });
  return metaRow;
}

function pruneJsonlMetaCache(files = []) {
  const active = new Set(files.map(cacheKey));
  for (const key of jsonlMetaCache.keys()) {
    if (!active.has(key)) {
      jsonlMetaCache.delete(key);
    }
  }
}

function workspaceRootForLockedThread(id, {
  threadWorkspaceRootHints = {},
  threadPermissionWorkspaceRoots = {}
} = {}) {
  const key = String(id || '').trim();
  if (!key) {
    return '';
  }
  const directHint = threadWorkspaceRootHints?.[key];
  if (typeof directHint === 'string' && directHint.trim()) {
    return path.resolve(directHint);
  }
  const permissionHint = threadPermissionWorkspaceRoots?.[key];
  if (typeof permissionHint === 'string' && permissionHint.trim()) {
    return path.resolve(permissionHint);
  }
  return '';
}

export function clearLocalSessionIndexCache() {
  jsonlMetaCache.clear();
}

export function mergeDesktopThreadLists(primaryThreads = [], fallbackThreads = []) {
  const byId = new Map();
  for (const thread of fallbackThreads) {
    if (thread?.id) {
      byId.set(thread.id, mergeDefined(byId.get(thread.id), thread));
    }
  }
  for (const thread of primaryThreads) {
    if (thread?.id) {
      byId.set(thread.id, mergeDefined(byId.get(thread.id), thread));
    }
  }
  return [...byId.values()].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

export async function readLocalSessionThreads({
  sessionIndexPath = CODEX_SESSION_INDEX,
  sessionsDir = CODEX_SESSIONS_DIR,
  limit = 1000,
  threadWorkspaceRootHints = {},
  threadPermissionWorkspaceRoots = {},
  readJsonlMetadata = readCachedFirstJsonLine
} = {}) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const diagnostics = {
    startedAt,
    completedAt: null,
    durationMs: null,
    visitedFiles: 0,
    jsonlFiles: 0,
    metaCacheHits: 0,
    metaCacheMisses: 0,
    metaCacheSize: 0,
    metaReadFailures: 0,
    lockedFallbackThreads: 0,
    returnedThreads: 0,
    error: null
  };

  try {
    const indexEntries = await readSessionIndex(sessionIndexPath);
    const { files, visitedFiles } = await walkJsonlFiles(sessionsDir);
    pruneJsonlMetaCache(files);
    diagnostics.visitedFiles = visitedFiles;
    diagnostics.jsonlFiles = files.length;
    const entries = new Map(indexEntries);

    await Promise.all(files.map(async (filePath) => {
      const id = threadIdFromFile(filePath);
      if (!id) {
        return;
      }
      const stat = await fs.stat(filePath);
      const existing = entries.get(id) || { id };
      const currentPath = existing.path;
      const currentMtime = Number(existing.fileMtimeMs || 0);
      if (!currentPath || stat.mtimeMs >= currentMtime) {
        entries.set(id, {
          ...existing,
          path: filePath,
          fileMtimeMs: stat.mtimeMs,
          fileSize: stat.size,
          fallbackUpdatedAtIso: existing.updatedAtIso || stat.mtime.toISOString()
        });
      }
    }));

    const threads = [];
    for (const entry of entries.values()) {
      if (!entry.path) {
        continue;
      }
      let metaRow = null;
      try {
        metaRow = await readJsonlMetadata(entry.path, {
          mtimeMs: entry.fileMtimeMs,
          size: entry.fileSize
        }, diagnostics);
      } catch (error) {
        diagnostics.metaReadFailures += 1;
        const fallbackCwd = workspaceRootForLockedThread(entry.id, {
          threadWorkspaceRootHints,
          threadPermissionWorkspaceRoots
        });
        if (!fallbackCwd) {
          continue;
        }
        diagnostics.lockedFallbackThreads += 1;
        threads.push({
          id: entry.id,
          name: entry.name || null,
          cwd: fallbackCwd,
          path: entry.path,
          preview: '',
          updatedAt: timestampSeconds(entry.updatedAtIso)
            ?? timestampSeconds(entry.fallbackUpdatedAtIso)
            ?? Number(entry.fileMtimeMs || 0) / 1000,
          source: 'vscode',
          modelProvider: null
        });
        continue;
      }
      const meta = metaRow?.type === 'session_meta' ? metaRow.payload || {} : {};
      const cwd = String(meta.cwd || '').trim();
      if (!cwd) {
        continue;
      }
      const updatedAt = timestampSeconds(entry.updatedAtIso)
        ?? timestampSeconds(entry.fallbackUpdatedAtIso)
        ?? timestampSeconds(meta.timestamp)
        ?? Number(entry.fileMtimeMs || 0) / 1000;
      threads.push({
        id: entry.id,
        name: entry.name || meta.thread_name || null,
        cwd,
        path: entry.path,
        preview: '',
        updatedAt,
        source: meta.source || 'local-session-index',
        modelProvider: meta.model_provider || meta.modelProvider || null
      });
    }

    const result = threads
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
      .slice(0, limit);
    diagnostics.returnedThreads = result.length;
    return result;
  } catch (error) {
    diagnostics.error = error?.message || 'Unknown local session index error';
    throw error;
  } finally {
    diagnostics.completedAt = new Date().toISOString();
    diagnostics.durationMs = Date.now() - startedMs;
    diagnostics.metaCacheSize = jsonlMetaCache.size;
    lastLocalSessionIndexDiagnostics = { ...diagnostics };
  }
}

export function getLocalSessionIndexDiagnostics() {
  return { ...lastLocalSessionIndexDiagnostics };
}
