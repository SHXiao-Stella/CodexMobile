import fs from 'node:fs/promises';
import path from 'node:path';
import {
  CODEX_SESSION_INDEX,
  CODEX_SESSIONS_DIR
} from './codex-config.js';

const THREAD_ID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
const FIRST_LINE_READ_LIMIT = 1024 * 1024;

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
      } else if (entry.isFile() && entry.name.endsWith('.jsonl') && threadIdFromFile(fullPath)) {
        files.push(fullPath);
      }
    }
  }
  await visit(root);
  return files;
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
  limit = 1000
} = {}) {
  const indexEntries = await readSessionIndex(sessionIndexPath);
  const files = await walkJsonlFiles(sessionsDir);
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
      metaRow = await readFirstJsonLine(entry.path);
    } catch {
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

  return threads
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
    .slice(0, limit);
}
