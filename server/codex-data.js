import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { archiveDesktopThread, listDesktopThreads, readDesktopThread, setDesktopThreadName } from './codex-app-server.js';
import { CODEX_STATE_DB, readCodexConfig, readCodexWorkspaceState } from './codex-config.js';
import {
  readMobileSessionIndex,
  renameMobileSession
} from './mobile-session-index.js';
import {
  mergeDesktopThreadLists,
  readLocalSessionThreads
} from './local-session-index.js';
import {
  createSessionMessageReader,
  readRolloutContextState
} from './session-message-reader.js';
import {
  buildSessionIndex,
  PROJECTLESS_PROJECT_ID,
  projectIdFor
} from './session-index-builder.js';
import {
  hideSessionInMobile,
  hideSessionMessageInLocalState,
  readHiddenSessionIds
} from './session-local-state.js';

export { rawSessionActivitiesFromJsonl } from './desktop-activity-parser.js';
export { messagesFromDesktopThread } from './desktop-thread-projector.js';
export { normalizeComparablePath } from './session-index-builder.js';

const INCLUDE_MISSING_SUBAGENT_THREADS = process.env.CODEXMOBILE_INCLUDE_MISSING_SUBAGENT_THREADS === '1';
const execFileAsync = promisify(execFile);

let cache = {
  syncedAt: null,
  config: null,
  projects: [],
  projectById: new Map(),
  sessionsByProject: new Map(),
  sessionById: new Map()
};

async function resolveSessionThread(sessionId) {
  const cached = cache.sessionById.get(sessionId);
  if (cached) {
    return cached;
  }
  const mobileIndex = await readMobileSessionIndex().catch(() => new Map());
  const mobileSession = mobileIndex.get(sessionId);
  if (!mobileSession) {
    return null;
  }
  return {
    id: sessionId,
    cwd: mobileSession.projectPath || '',
    projectless: Boolean(mobileSession.projectless),
    filePath: mobileSession.filePath || null
  };
}

const sessionMessageReader = createSessionMessageReader({
  resolveSessionThread,
  getConfigContext: () => cache.config?.context || {}
});

function toPublicProject(entry) {
  return {
    id: entry.id,
    name: entry.name,
    path: entry.path,
    pathLabel: entry.pathLabel || null,
    projectless: Boolean(entry.projectless),
    trusted: entry.trusted,
    updatedAt: entry.updatedAt,
    sessionCount: entry.sessionCount || 0
  };
}

async function readThreadSpawnEdges() {
  try {
    await fs.access(CODEX_STATE_DB);
    const query = `
      select
        parent_thread_id as parentSessionId,
        child_thread_id as childSessionId,
        status
      from thread_spawn_edges
    `;
    const { stdout } = await execFileAsync('sqlite3', ['-json', CODEX_STATE_DB, query], {
      maxBuffer: 1024 * 1024
    });
    const parsed = JSON.parse(stdout || '[]');
    return Array.isArray(parsed)
      ? parsed.filter((edge) => edge?.parentSessionId && edge?.childSessionId)
      : [];
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[sessions] Failed to read subagent thread edges:', error.message);
    }
    return [];
  }
}

export async function refreshCodexCache() {
  const config = await readCodexConfig();
  const workspaceState = await readCodexWorkspaceState();
  const mobileSessionIndex = await readMobileSessionIndex();
  const hiddenSessionIds = await readHiddenSessionIds();
  const spawnEdges = INCLUDE_MISSING_SUBAGENT_THREADS ? await readThreadSpawnEdges() : [];
  const [desktopThreads, localSessionThreads] = await Promise.all([
    listDesktopThreads({ limit: 1000 }).catch((error) => {
      console.warn('[sessions] Failed to list desktop threads:', error.message);
      return [];
    }),
    readLocalSessionThreads({ limit: 1000 }).catch((error) => {
      console.warn('[sessions] Failed to read local session index:', error.message);
      return [];
    })
  ]);
  const sessionIndex = await buildSessionIndex({
    config,
    workspaceState,
    mobileSessionIndex,
    hiddenSessionIds,
    desktopThreads: mergeDesktopThreadLists(desktopThreads, localSessionThreads),
    spawnEdges,
    includeMissingSubagentThreads: INCLUDE_MISSING_SUBAGENT_THREADS,
    readDesktopThread,
    readRolloutContextState
  });

  cache = {
    syncedAt: new Date().toISOString(),
    config,
    ...sessionIndex
  };

  return getCacheSnapshot();
}

export function getCacheSnapshot() {
  return {
    syncedAt: cache.syncedAt,
    config: cache.config,
    projects: cache.projects.map(toPublicProject)
  };
}

export function listProjects() {
  return cache.projects.map(toPublicProject);
}

export function getProject(projectId) {
  return cache.projectById.get(projectId) || null;
}

export function listProjectSessions(projectId) {
  return (cache.sessionsByProject.get(projectId) || []).map((session) => ({
    id: session.id,
    projectId: session.projectId,
    cwd: session.cwd,
    title: session.title,
    summary: session.summary,
    model: session.model,
    provider: session.provider,
    source: session.source,
    parentSessionId: session.parentSessionId || null,
    isSubAgent: Boolean(session.isSubAgent),
    subAgent: session.subAgent || null,
    childCount: session.childCount || 0,
    openChildCount: session.openChildCount || 0,
    messageCount: session.messageCount,
    updatedAt: session.updatedAt,
    runtime: session.runtime || null,
    context: session.context || null
  }));
}

export function getSession(sessionId) {
  return cache.sessionById.get(sessionId) || null;
}

export function rememberLiveSession(session = {}) {
  const id = String(session.id || session.sessionId || '').trim();
  if (!id || id.startsWith('draft-') || id.startsWith('codex-')) {
    return null;
  }
  const existing = cache.sessionById.get(id) || {};
  const projectPath = session.projectPath || session.cwd || existing.cwd || '';
  const projectless = Boolean(session.projectless || session.projectId === PROJECTLESS_PROJECT_ID || existing.projectless);
  const projectId = session.projectId || existing.projectId || (projectless ? PROJECTLESS_PROJECT_ID : (projectPath ? projectIdFor(projectPath) : null));
  const resolvedCwd = projectPath ? path.resolve(projectPath) : existing.cwd || '';
  const updatedAt = session.updatedAt || existing.updatedAt || new Date().toISOString();
  const title = String(session.title || existing.title || session.summary || '新对话').trim();
  const summary = String(session.summary || existing.summary || title || 'CodexMobile 对话').trim();
  const next = {
    ...existing,
    id,
    cwd: resolvedCwd,
    projectId,
    title,
    titleLocked: Boolean(existing.titleLocked || session.titleLocked),
    summary,
    messageCount: Array.isArray(session.messages) ? session.messages.length : existing.messageCount || 0,
    updatedAt,
    source: session.source || existing.source || 'codexmobile',
    projectless,
    mobileSessionKnown: true,
    filePath: session.filePath || existing.filePath || null,
    context: existing.context || null
  };
  cache.sessionById.set(id, next);

  if (projectId && cache.projectById.has(projectId)) {
    const current = cache.sessionsByProject.get(projectId) || [];
    const filtered = current.filter((item) => item.id !== id);
    cache.sessionsByProject.set(projectId, [next, ...filtered]);
  }
  return next;
}

export async function renameSession(sessionId, projectId, title, { auto = false } = {}) {
  const session = getSession(sessionId);
  if (!session) {
    const error = new Error('Session not found');
    error.statusCode = 404;
    throw error;
  }
  if (projectId && session.projectId !== projectId) {
    const error = new Error('Session not found in project');
    error.statusCode = 404;
    throw error;
  }

  const nextTitle = String(title || '').trim().slice(0, 52);
  if (!nextTitle) {
    const error = new Error('Title is required');
    error.statusCode = 400;
    throw error;
  }

  if (!session.mobileOnly) {
    await setDesktopThreadName(session.id, nextTitle);
  }
  await renameMobileSession({
    id: session.id,
    projectPath: session.cwd,
    projectless: session.projectless,
    title: nextTitle,
    titleLocked: !auto,
    updatedAt: session.updatedAt
  });

  return { ...session, title: nextTitle, titleLocked: !auto };
}

export async function deleteSession(sessionId, projectId) {
  const session = getSession(sessionId);
  if (!session) {
    const error = new Error('Session not found');
    error.statusCode = 404;
    throw error;
  }
  if (projectId && session.projectId !== projectId) {
    const error = new Error('Session not found in project');
    error.statusCode = 404;
    throw error;
  }

  let archivedDesktopThread = false;
  if (!session.mobileOnly) {
    await archiveDesktopThread(session.id);
    archivedDesktopThread = true;
  }

  const hidden = await hideSessionInMobile(session);

  return {
    deletedSessionId: sessionId,
    projectId: session.projectId,
    hiddenOnly: !archivedDesktopThread,
    archivedDesktopThread,
    hiddenAt: hidden.hiddenAt,
    deletedFile: false,
    deletedIndexRows: false,
    deletedMobileRecord: false
  };
}

export async function hideSessionMessage(sessionId, messageId) {
  return hideSessionMessageInLocalState(sessionId, messageId);
}

export async function readSessionMessages(sessionId, options = {}) {
  return sessionMessageReader.readSessionMessages(sessionId, options);
}

export function getHostName() {
  return os.hostname();
}
