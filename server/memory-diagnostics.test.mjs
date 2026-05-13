import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryDiagnosticsSnapshot } from './memory-diagnostics.js';

test('memory diagnostics snapshot keeps only operational counts', () => {
  const snapshot = createMemoryDiagnosticsSnapshot({
    now: () => '2026-05-13T00:00:00.000Z',
    pid: 123,
    memoryUsage: () => ({
      rss: 100,
      heapTotal: 80,
      heapUsed: 40,
      external: 10,
      arrayBuffers: 5
    }),
    uptime: () => 12.5,
    nodeVersion: 'v99.0.0',
    platform: 'test',
    arch: 'x64',
    socketCount: () => 2,
    cacheSnapshot: () => ({
      projectCount: 2,
      sessionCount: 3,
      sessionsByProject: { projectA: 2, projectB: 1 },
      secretPrompt: 'must not be copied'
    }),
    syncDiagnostics: () => ({
      durationMs: 42,
      desktopThreadCount: 4,
      localThreadCount: 5,
      scannedFiles: 6,
      metaCacheHits: 2,
      metaCacheMisses: 1,
      metaCacheSize: 3,
      finalSessionCount: 7
    }),
    chatDiagnostics: () => ({
      queues: { queuedJobCount: 1 },
      runs: { activeLocalRuns: 2 },
      userInput: { pendingCount: 3, privateQuestion: 'must not be copied' }
    }),
    managedProcesses: () => [
      { id: 1, pid: 456, name: 'codex app-server', startedAt: '2026-05-13T00:00:00.000Z' }
    ]
  });

  assert.equal(snapshot.generatedAt, '2026-05-13T00:00:00.000Z');
  assert.equal(snapshot.process.pid, 123);
  assert.equal(snapshot.process.nodeVersion, 'v99.0.0');
  assert.equal(snapshot.process.memory.rss, 100);
  assert.equal(snapshot.sockets.webSocketClients, 2);
  assert.equal(snapshot.cache.projectCount, 2);
  assert.equal(snapshot.cache.sessionCount, 3);
  assert.deepEqual(snapshot.cache.sessionsByProject, { projectA: 2, projectB: 1 });
  assert.equal(snapshot.sync.scannedFiles, 6);
  assert.equal(snapshot.sync.metaCacheHits, 2);
  assert.equal(snapshot.sync.metaCacheMisses, 1);
  assert.equal(snapshot.sync.metaCacheSize, 3);
  assert.equal(snapshot.runs.activeLocalRuns, 2);
  assert.equal(snapshot.queues.queuedJobCount, 1);
  assert.equal(snapshot.userInput.pendingCount, 3);
  assert.equal(snapshot.processes.count, 1);

  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes('must not be copied'), false);
  assert.equal(serialized.includes('secretPrompt'), false);
  assert.equal(serialized.includes('privateQuestion'), false);
});
