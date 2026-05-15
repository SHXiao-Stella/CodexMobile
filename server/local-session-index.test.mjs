import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  clearLocalSessionIndexCache,
  getLocalSessionIndexDiagnostics,
  mergeDesktopThreadLists,
  readLocalSessionThreads
} from './local-session-index.js';

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmobile-local-sessions-'));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function writeRollout(root, { id, cwd, timestamp = '2026-05-10T08:00:00.000Z', source = 'exec' }) {
  const dir = path.join(root, 'sessions', '2026', '05', '10');
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `rollout-2026-05-10T16-00-00-${id}.jsonl`);
  await fs.writeFile(filePath, [
    JSON.stringify({
      timestamp,
      type: 'session_meta',
      payload: {
        id,
        timestamp,
        cwd,
        source,
        model_provider: 'openai'
      }
    }),
    JSON.stringify({
      timestamp,
      type: 'event_msg',
      payload: { type: 'task_started' }
    })
  ].join('\n'));
  return filePath;
}

test('readLocalSessionThreads restores desktop sessions from local jsonl files', async () => {
  clearLocalSessionIndexCache();
  await withTempDir(async (dir) => {
    const id = '019e1173-28f3-7d21-a1b9-9d72b3362714';
    const cwd = path.join(dir, 'ProjectA');
    const filePath = await writeRollout(dir, { id, cwd });
    const indexPath = path.join(dir, 'session_index.jsonl');
    await fs.writeFile(indexPath, [
      JSON.stringify({ id, thread_name: 'Old title', updated_at: '2026-05-10T07:00:00.000Z' }),
      JSON.stringify({ id, thread_name: 'Latest title', updated_at: '2026-05-10T09:00:00.000Z' })
    ].join('\n'));

    const threads = await readLocalSessionThreads({
      sessionIndexPath: indexPath,
      sessionsDir: path.join(dir, 'sessions')
    });

    assert.equal(threads.length, 1);
    assert.equal(threads[0].id, id);
    assert.equal(threads[0].name, 'Latest title');
    assert.equal(threads[0].cwd, cwd);
    assert.equal(threads[0].path, filePath);
    assert.equal(threads[0].source, 'exec');
    assert.equal(threads[0].modelProvider, 'openai');
    assert.equal(threads[0].updatedAt, Date.parse('2026-05-10T09:00:00.000Z') / 1000);

    const diagnostics = getLocalSessionIndexDiagnostics();
    assert.equal(diagnostics.returnedThreads, 1);
    assert.equal(diagnostics.jsonlFiles, 1);
    assert.equal(diagnostics.visitedFiles >= 1, true);
    assert.equal(Number.isFinite(diagnostics.durationMs), true);
  });
});

test('readLocalSessionThreads reuses cached jsonl metadata until file mtime or size changes', async () => {
  clearLocalSessionIndexCache();
  await withTempDir(async (dir) => {
    const id = '019e1173-28f3-7d21-a1b9-9d72b3362714';
    const cwd = path.join(dir, 'ProjectA');
    await writeRollout(dir, { id, cwd });
    const indexPath = path.join(dir, 'session_index.jsonl');

    const first = await readLocalSessionThreads({
      sessionIndexPath: indexPath,
      sessionsDir: path.join(dir, 'sessions')
    });
    const firstDiagnostics = getLocalSessionIndexDiagnostics();
    assert.equal(first.length, 1);
    assert.equal(firstDiagnostics.metaCacheHits, 0);
    assert.equal(firstDiagnostics.metaCacheMisses, 1);

    const second = await readLocalSessionThreads({
      sessionIndexPath: indexPath,
      sessionsDir: path.join(dir, 'sessions')
    });
    const secondDiagnostics = getLocalSessionIndexDiagnostics();
    assert.equal(second.length, 1);
    assert.equal(secondDiagnostics.metaCacheHits, 1);
    assert.equal(secondDiagnostics.metaCacheMisses, 0);
    assert.equal(secondDiagnostics.metaCacheSize, 1);
  });
});

test('readLocalSessionThreads keeps locked active desktop sessions when workspace root is known', async () => {
  clearLocalSessionIndexCache();
  await withTempDir(async (dir) => {
    const id = '019e10ec-e8ef-7940-8532-4266412a0586';
    const cwd = path.join(dir, 'LBCode');
    const filePath = await writeRollout(dir, { id, cwd });
    const indexPath = path.join(dir, 'session_index.jsonl');
    await fs.writeFile(indexPath, JSON.stringify({
      id,
      thread_name: 'Active locked thread',
      updated_at: '2026-05-15T08:10:01.000Z'
    }));

    const threads = await readLocalSessionThreads({
      sessionIndexPath: indexPath,
      sessionsDir: path.join(dir, 'sessions'),
      threadPermissionWorkspaceRoots: { [id]: cwd },
      readJsonlMetadata: async () => {
        const error = new Error('locked');
        error.code = 'EPERM';
        throw error;
      }
    });

    assert.equal(threads.length, 1);
    assert.equal(threads[0].id, id);
    assert.equal(threads[0].name, 'Active locked thread');
    assert.equal(threads[0].cwd, cwd);
    assert.equal(threads[0].path, filePath);
    assert.equal(threads[0].source, 'vscode');
    assert.equal(threads[0].updatedAt, Date.parse('2026-05-15T08:10:01.000Z') / 1000);

    const diagnostics = getLocalSessionIndexDiagnostics();
    assert.equal(diagnostics.metaReadFailures, 1);
    assert.equal(diagnostics.lockedFallbackThreads, 1);
  });
});

test('mergeDesktopThreadLists keeps app-server data and fills missing local fields', () => {
  const merged = mergeDesktopThreadLists([
    {
      id: 'thread-1',
      name: 'Desktop title',
      status: 'running',
      updatedAt: 20
    }
  ], [
    {
      id: 'thread-1',
      name: 'Local title',
      cwd: 'D:/Project',
      path: 'C:/Users/Shuhua/.codex/sessions/thread-1.jsonl',
      updatedAt: 10
    },
    {
      id: 'thread-2',
      name: 'Only local',
      cwd: 'D:/Other',
      updatedAt: 30
    }
  ]);

  assert.deepEqual(merged.map((thread) => thread.id), ['thread-2', 'thread-1']);
  assert.equal(merged[1].name, 'Desktop title');
  assert.equal(merged[1].cwd, 'D:/Project');
  assert.equal(merged[1].path, 'C:/Users/Shuhua/.codex/sessions/thread-1.jsonl');
  assert.equal(merged[1].status, 'running');
  assert.equal(merged[1].updatedAt, 20);
});
