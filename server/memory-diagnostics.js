function readValue(value) {
  return typeof value === 'function' ? value() : value;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function pickNumberFields(source = {}, fields = []) {
  const result = {};
  for (const field of fields) {
    if (source[field] !== undefined) {
      result[field] = finiteNumber(source[field]);
    }
  }
  return result;
}

function sanitizeString(value) {
  return value === undefined || value === null ? null : String(value);
}

function sanitizeSessionsByProject(value = {}) {
  const result = {};
  for (const [projectId, count] of Object.entries(value || {})) {
    result[String(projectId)] = finiteNumber(count);
  }
  return result;
}

function sanitizeCache(cache = {}) {
  return {
    syncedAt: sanitizeString(cache.syncedAt),
    projectCount: finiteNumber(cache.projectCount),
    sessionCount: finiteNumber(cache.sessionCount),
    sessionsByProject: sanitizeSessionsByProject(cache.sessionsByProject)
  };
}

function sanitizeSync(sync = {}) {
  return {
    startedAt: sanitizeString(sync.startedAt),
    completedAt: sanitizeString(sync.completedAt),
    durationMs: sync.durationMs === null || sync.durationMs === undefined ? null : finiteNumber(sync.durationMs),
    desktopThreadCount: finiteNumber(sync.desktopThreadCount),
    localThreadCount: finiteNumber(sync.localThreadCount),
    scannedFiles: finiteNumber(sync.scannedFiles),
    visitedFiles: finiteNumber(sync.visitedFiles),
    jsonlFiles: finiteNumber(sync.jsonlFiles),
    metaCacheHits: finiteNumber(sync.metaCacheHits),
    metaCacheMisses: finiteNumber(sync.metaCacheMisses),
    metaCacheSize: finiteNumber(sync.metaCacheSize),
    finalSessionCount: finiteNumber(sync.finalSessionCount),
    projectCount: finiteNumber(sync.projectCount),
    sessionCount: finiteNumber(sync.sessionCount),
    error: sync.error ? String(sync.error) : null
  };
}

function sanitizePendingByThread(value = {}) {
  const result = {};
  for (const [threadId, count] of Object.entries(value || {})) {
    result[String(threadId)] = finiteNumber(count);
  }
  return result;
}

function sanitizeChatDiagnostics(chat = {}) {
  const queues = pickNumberFields(chat.queues || {}, [
    'recentTurnCount',
    'conversationQueueCount',
    'runningQueueCount',
    'queuedJobCount',
    'sessionAliasCount'
  ]);
  const runs = pickNumberFields(chat.runs || {}, [
    'activeLocalRuns',
    'activeDesktopRuns',
    'activeImageRuns',
    'activeRunCount',
    'keyCount'
  ]);
  const userInput = {
    pendingCount: finiteNumber(chat.userInput?.pendingCount),
    pendingByThread: sanitizePendingByThread(chat.userInput?.pendingByThread)
  };
  return { queues, runs, userInput };
}

function sanitizeManagedProcesses(processes = []) {
  return Array.isArray(processes)
    ? processes.map((entry) => ({
      id: finiteNumber(entry?.id),
      pid: finiteNumber(entry?.pid),
      name: sanitizeString(entry?.name) || 'child-process',
      startedAt: sanitizeString(entry?.startedAt)
    }))
    : [];
}

export function createMemoryDiagnosticsSnapshot({
  now = () => new Date().toISOString(),
  pid = process.pid,
  memoryUsage = () => process.memoryUsage(),
  uptime = () => process.uptime(),
  nodeVersion = process.version,
  platform = process.platform,
  arch = process.arch,
  socketCount = () => 0,
  cacheSnapshot = () => ({}),
  syncDiagnostics = () => ({}),
  chatDiagnostics = () => ({}),
  managedProcesses = () => []
} = {}) {
  const memory = readValue(memoryUsage) || {};
  const cache = sanitizeCache(readValue(cacheSnapshot) || {});
  const sync = sanitizeSync(readValue(syncDiagnostics) || {});
  const chat = sanitizeChatDiagnostics(readValue(chatDiagnostics) || {});
  const processes = sanitizeManagedProcesses(readValue(managedProcesses) || []);

  return {
    generatedAt: readValue(now),
    process: {
      pid: finiteNumber(readValue(pid)),
      nodeVersion: sanitizeString(readValue(nodeVersion)),
      platform: sanitizeString(readValue(platform)),
      arch: sanitizeString(readValue(arch)),
      uptimeSeconds: finiteNumber(readValue(uptime)),
      memory: pickNumberFields(memory, ['rss', 'heapTotal', 'heapUsed', 'external', 'arrayBuffers'])
    },
    sockets: {
      webSocketClients: finiteNumber(readValue(socketCount))
    },
    cache,
    sync,
    runs: chat.runs,
    queues: chat.queues,
    userInput: chat.userInput,
    processes: {
      count: processes.length,
      items: processes
    }
  };
}
