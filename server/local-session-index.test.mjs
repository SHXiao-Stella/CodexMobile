import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
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
