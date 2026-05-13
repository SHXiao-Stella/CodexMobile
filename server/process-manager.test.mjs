import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  __resetManagedProcessesForTest,
  installManagedProcessShutdown,
  managedProcessSnapshot,
  registerManagedProcess,
  shutdownManagedProcesses
} from './process-manager.js';

test.beforeEach(() => {
  __resetManagedProcessesForTest();
});

test.afterEach(() => {
  __resetManagedProcessesForTest();
});

function fakeChild(pid = 1234) {
  const child = new EventEmitter();
  child.pid = pid;
  child.signals = [];
  child.kill = (signal) => {
    child.signals.push(signal);
  };
  return child;
}

test('registerManagedProcess tracks pid, name, and start time', () => {
  const child = fakeChild(1001);
  registerManagedProcess(child, { name: 'codex app-server headless-local' });

  const snapshot = managedProcessSnapshot();

  assert.equal(snapshot.length, 1);
  assert.equal(snapshot[0].pid, 1001);
  assert.equal(snapshot[0].name, 'codex app-server headless-local');
  assert.match(snapshot[0].startedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('registered child is removed after close or exit', () => {
  const closed = fakeChild(1002);
  const exited = fakeChild(1003);
  registerManagedProcess(closed, { name: 'closed child' });
  registerManagedProcess(exited, { name: 'exited child' });

  closed.emit('close');
  exited.emit('exit');

  assert.deepEqual(managedProcessSnapshot(), []);
});

test('registerManagedProcess ignores targets without a pid', () => {
  const child = new EventEmitter();
  const unregister = registerManagedProcess(child, { name: 'missing pid' });

  unregister();

  assert.deepEqual(managedProcessSnapshot(), []);
});

test('shutdownManagedProcesses sends SIGTERM then SIGKILL to stubborn children', async () => {
  const child = fakeChild(1004);
  registerManagedProcess(child, { name: 'stubborn child' });

  await shutdownManagedProcesses({ timeoutMs: 1 });
  await shutdownManagedProcesses({ timeoutMs: 1 });

  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
  assert.deepEqual(managedProcessSnapshot(), []);
});

test('installManagedProcessShutdown runs cleanup and exits with signal code', async () => {
  const handlers = {};
  const calls = [];
  const fakeProcess = {
    on(signal, handler) {
      handlers[signal] = handler;
    },
    off(signal, handler) {
      if (handlers[signal] === handler) {
        delete handlers[signal];
      }
    }
  };

  const uninstall = installManagedProcessShutdown({
    processLike: fakeProcess,
    timeoutMs: 7,
    beforeShutdown: async (signal) => {
      calls.push(['before', signal]);
    },
    shutdownManaged: async ({ timeoutMs }) => {
      calls.push(['shutdown', timeoutMs]);
    },
    exit: (code) => {
      calls.push(['exit', code]);
    }
  });

  assert.equal(typeof handlers.SIGINT, 'function');
  assert.equal(typeof handlers.SIGTERM, 'function');

  await handlers.SIGINT();
  await handlers.SIGTERM();
  uninstall();

  assert.deepEqual(calls, [
    ['before', 'SIGINT'],
    ['shutdown', 7],
    ['exit', 130]
  ]);
  assert.deepEqual(Object.keys(handlers), []);
});
