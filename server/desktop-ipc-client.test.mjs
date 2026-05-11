import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as desktopIpc from './desktop-ipc-client.js';

const { DesktopIpcClient, desktopIpcMethodVersion } = desktopIpc;

function testSocketPath(dir) {
  if (process.platform === 'win32') {
    return String.raw`\\.\pipe\codexmobile-ipc-test-${process.pid}-${randomUUID()}`;
  }
  return path.join(dir, 'ipc.sock');
}

test('desktop follower IPC methods use the current desktop protocol version', () => {
  assert.equal(desktopIpcMethodVersion('initialize'), 0);
  assert.equal(desktopIpcMethodVersion('thread-archived'), 2);
  assert.equal(desktopIpcMethodVersion('thread-stream-state-changed'), 6);
  assert.equal(desktopIpcMethodVersion('thread-follower-start-turn'), 1);
  assert.equal(desktopIpcMethodVersion('thread-follower-steer-turn'), 1);
  assert.equal(desktopIpcMethodVersion('thread-follower-interrupt-turn'), 1);
});

function frameFor(payload) {
  const json = JSON.stringify(payload);
  const frame = Buffer.alloc(4 + Buffer.byteLength(json));
  frame.writeUInt32LE(Buffer.byteLength(json), 0);
  frame.write(json, 4);
  return frame;
}

function readFrame(socket) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    let expected = null;
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (expected == null && buffer.length >= 4) {
        expected = buffer.readUInt32LE(0);
        buffer = buffer.subarray(4);
      }
      if (expected != null && buffer.length >= expected) {
        socket.off('data', onData);
        resolve(JSON.parse(buffer.subarray(0, expected).toString('utf8')));
      }
    };
    socket.on('data', onData);
    socket.once('error', reject);
  });
}

test('sendBroadcast writes desktop IPC broadcast frames', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmobile-ipc-test-'));
  const socketPath = testSocketPath(dir);
  const server = net.createServer();
  await new Promise((resolve) => server.listen(socketPath, resolve));

  const accepted = new Promise((resolve) => server.once('connection', resolve));
  const client = new DesktopIpcClient({ clientType: 'codexmobile-test', socketPath });
  const connected = client.connect({ timeoutMs: 1000 });
  const socket = await accepted;
  const init = await readFrame(socket);
  socket.write(frameFor({
    type: 'response',
    requestId: init.requestId,
    resultType: 'success',
    method: 'initialize',
    result: { clientId: 'client-1' }
  }));
  await connected;

  client.sendBroadcast('thread-archived', {
    hostId: 'local',
    conversationId: 'thread-1',
    cwd: null
  });
  const broadcast = await readFrame(socket);

  assert.equal(broadcast.type, 'broadcast');
  assert.equal(broadcast.method, 'thread-archived');
  assert.equal(broadcast.sourceClientId, 'client-1');
  assert.equal(broadcast.version, 2);
  assert.deepEqual(broadcast.params, {
    hostId: 'local',
    conversationId: 'thread-1',
    cwd: null
  });

  client.close();
  socket.destroy();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(dir, { recursive: true, force: true });
});

test('broadcastDesktopThreadTitleUpdated writes desktop title update broadcast frames', async () => {
  assert.equal(typeof desktopIpc.broadcastDesktopThreadTitleUpdated, 'function');

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmobile-ipc-test-'));
  const socketPath = testSocketPath(dir);
  const server = net.createServer();
  await new Promise((resolve) => server.listen(socketPath, resolve));

  const accepted = new Promise((resolve) => server.once('connection', resolve));
  const sent = desktopIpc.broadcastDesktopThreadTitleUpdated('thread-1', 'Renamed thread', {
    hostId: 'local',
    socketPath,
    timeoutMs: 1000
  });
  const socket = await accepted;
  const init = await readFrame(socket);
  socket.write(frameFor({
    type: 'response',
    requestId: init.requestId,
    resultType: 'success',
    method: 'initialize',
    result: { clientId: 'client-1' }
  }));
  const broadcast = await readFrame(socket);
  const result = await sent;

  assert.deepEqual(result, { sent: true });
  assert.equal(broadcast.type, 'broadcast');
  assert.equal(broadcast.method, 'thread-title-updated');
  assert.equal(broadcast.sourceClientId, 'client-1');
  assert.equal(broadcast.version, 0);
  assert.deepEqual(broadcast.params, {
    hostId: 'local',
    conversationId: 'thread-1',
    title: 'Renamed thread'
  });

  socket.destroy();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(dir, { recursive: true, force: true });
});

test('requestDesktopThreadSnapshotRefresh asks desktop owners to rebroadcast snapshots', async () => {
  assert.equal(typeof desktopIpc.requestDesktopThreadSnapshotRefresh, 'function');

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmobile-ipc-test-'));
  const socketPath = testSocketPath(dir);
  const server = net.createServer();
  await new Promise((resolve) => server.listen(socketPath, resolve));

  const accepted = new Promise((resolve) => server.once('connection', resolve));
  const sent = desktopIpc.requestDesktopThreadSnapshotRefresh('thread-1', {
    socketPath,
    timeoutMs: 1000
  });
  const socket = await accepted;
  const init = await readFrame(socket);
  socket.write(frameFor({
    type: 'response',
    requestId: init.requestId,
    resultType: 'success',
    method: 'initialize',
    result: { clientId: 'client-1' }
  }));
  const broadcast = await readFrame(socket);
  const result = await sent;

  assert.deepEqual(result, { sent: true });
  assert.equal(broadcast.type, 'broadcast');
  assert.equal(broadcast.method, 'client-status-changed');
  assert.equal(broadcast.sourceClientId, 'client-1');
  assert.equal(broadcast.version, 0);
  assert.deepEqual(broadcast.params, {
    clientId: 'client-1',
    status: 'connected',
    conversationId: 'thread-1'
  });

  socket.destroy();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(dir, { recursive: true, force: true });
});
