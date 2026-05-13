import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import {
  CodexAppServerClient,
  codexAppServerSpawnOptions,
  desktopBridgeStatusForAppServerTransport,
  listDesktopThreads,
  readDesktopThread,
  resolveAppServerTransport
} from './codex-app-server.js';
import {
  __resetManagedProcessesForTest,
  managedProcessSnapshot
} from './process-manager.js';

test.afterEach(() => {
  __resetManagedProcessesForTest();
});

test('resolveAppServerTransport is strict and unavailable without a desktop socket', () => {
  const transport = resolveAppServerTransport({
    CODEXMOBILE_CODEX_APP_SERVER_SOCK: '/tmp/codexmobile-missing.sock'
  });

  assert.equal(transport.strict, true);
  assert.equal(transport.connected, false);
  assert.equal(transport.mode, 'unavailable');
  assert.match(transport.reason, /不存在|未找到|No such/i);
});

test('resolveAppServerTransport only allows isolated app-server behind an explicit dev flag', () => {
  const transport = resolveAppServerTransport({
    CODEXMOBILE_CODEX_APP_SERVER_SOCK: '/tmp/codexmobile-missing.sock',
    CODEXMOBILE_ALLOW_ISOLATED_CODEX: '1'
  });

  assert.equal(transport.strict, false);
  assert.equal(transport.connected, true);
  assert.equal(transport.mode, 'isolated-dev');
});

test('resolveAppServerTransport can use a headless local fallback when explicitly allowed', () => {
  const transport = resolveAppServerTransport({
    CODEXMOBILE_CODEX_APP_SERVER_SOCK: '/tmp/codexmobile-missing.sock'
  }, { allowHeadlessLocal: true });

  assert.equal(transport.strict, false);
  assert.equal(transport.connected, true);
  assert.equal(transport.mode, 'headless-local');
  assert.match(transport.reason, /后台 Codex/);
});

test('codex app-server child process is hidden on Windows', () => {
  const options = codexAppServerSpawnOptions({ cwd: '/repo', env: { TEST_ENV: '1' } });

  assert.equal(options.windowsHide, true);
  assert.equal(options.cwd, '/repo');
  assert.deepEqual(options.stdio, ['pipe', 'pipe', 'pipe']);
});

test('codex app-server child process is managed until it closes', () => {
  const child = new EventEmitter();
  child.pid = 4101;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {};

  const client = new CodexAppServerClient({
    env: { CODEXMOBILE_CODEX_BINARY: process.execPath },
    transport: { mode: 'headless-local', connected: true, strict: false },
    spawnImpl: () => child
  });

  try {
    client.start();
    assert.deepEqual(managedProcessSnapshot().map((entry) => [entry.pid, entry.name]), [
      [4101, 'codex app-server headless-local']
    ]);

    child.emit('close', 0, null);
    assert.deepEqual(managedProcessSnapshot(), []);
  } finally {
    client.close();
  }
});

test('desktop bridge status reports headless fallback without spawning app-server', () => {
  const status = desktopBridgeStatusForAppServerTransport({
    mode: 'headless-local',
    strict: false,
    connected: true,
    reason: 'background fallback'
  }, {
    checkedAt: '2026-05-11T00:00:00.000Z',
    ipcReason: 'desktop ipc unavailable'
  });

  assert.equal(status.connected, true);
  assert.equal(status.mode, 'headless-local');
  assert.equal(status.capabilities.createThread, true);
  assert.equal(status.capabilities.backgroundCodex, true);
  assert.equal(status.capabilities.read, false);
});

test('desktop thread listing skips unavailable bridges instead of starting isolated app-server', async () => {
  let createClientCalled = false;
  const threads = await listDesktopThreads({
    transport: {
      mode: 'unavailable',
      strict: true,
      connected: false,
      reason: 'no desktop socket'
    },
    createClient: async () => {
      createClientCalled = true;
      throw new Error('should not start app-server');
    }
  });

  assert.deepEqual(threads, []);
  assert.equal(createClientCalled, false);
});

test('desktop thread listing can use an injected desktop-proxy client', async () => {
  const closed = [];
  const threads = await listDesktopThreads({
    transport: {
      mode: 'desktop-proxy',
      strict: true,
      connected: true,
      sockPath: '/tmp/codex.sock'
    },
    createClient: async () => ({
      async request() {
        return {
          data: [{ id: 'thread-1', status: 'active' }],
          nextCursor: null
        };
      },
      close() {
        closed.push(true);
      }
    })
  });

  assert.deepEqual(threads.map((thread) => thread.id), ['thread-1']);
  assert.equal(closed.length, 1);
});

test('desktop thread read skips unavailable bridges so rollout fallback can handle it', async () => {
  await assert.rejects(
    () => readDesktopThread('thread-1', {
      transport: {
        mode: 'unavailable',
        strict: true,
        connected: false,
        reason: 'no desktop socket'
      },
      createClient: async () => {
        throw new Error('should not start app-server');
      }
    }),
    (error) => error?.statusCode === 404 && /not found/i.test(error.message)
  );
});

test('desktop thread read can use an injected desktop-proxy client', async () => {
  const response = await readDesktopThread('thread-1', {
    transport: {
      mode: 'desktop-proxy',
      strict: true,
      connected: true,
      sockPath: '/tmp/codex.sock'
    },
    createClient: async () => ({
      async request(method, params) {
        assert.equal(method, 'thread/read');
        assert.equal(params.threadId, 'thread-1');
        return { thread: { id: 'thread-1' } };
      },
      close() {}
    })
  });

  assert.equal(response.thread.id, 'thread-1');
});
