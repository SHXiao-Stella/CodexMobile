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
  assert.equal(desktopIpcMethodVersion('thread-follower-submit-user-input'), 1);
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

test('submitDesktopFollowerUserInput sends the desktop IPC response frame', async () => {
  assert.equal(typeof desktopIpc.submitDesktopFollowerUserInput, 'function');

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmobile-ipc-test-'));
  const socketPath = testSocketPath(dir);
  const server = net.createServer();
  await new Promise((resolve) => server.listen(socketPath, resolve));

  const accepted = new Promise((resolve) => server.once('connection', resolve));
  const submitted = desktopIpc.submitDesktopFollowerUserInput('thread-1', {
    threadId: 'thread-1',
    turnId: 'turn-1',
    itemId: 'item-1',
    response: { answers: { choice: { answers: ['Yes'] } } }
  }, {
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
  const request = await readFrame(socket);
  socket.write(frameFor({
    type: 'response',
    requestId: request.requestId,
    resultType: 'success',
    method: 'thread-follower-submit-user-input',
    result: { accepted: true }
  }));
  const result = await submitted;

  assert.deepEqual(result, { accepted: true });
  assert.equal(request.type, 'request');
  assert.equal(request.method, 'thread-follower-submit-user-input');
  assert.equal(request.version, 1);
  assert.deepEqual(request.params, {
    conversationId: 'thread-1',
    threadId: 'thread-1',
    turnId: 'turn-1',
    itemId: 'item-1',
    response: { answers: { choice: { answers: ['Yes'] } } }
  });

  socket.destroy();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(dir, { recursive: true, force: true });
});

test('desktop ipc tracks approval requests from thread stream state snapshots', async () => {
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

  const upserted = new Promise((resolve) => client.once('requestUpserted', resolve));
  const stateChanged = new Promise((resolve) => client.once('conversationStateChanged', resolve));
  socket.write(frameFor({
    type: 'broadcast',
    method: 'thread-stream-state-changed',
    sourceClientId: 'owner-1',
    params: {
      conversationId: 'thread-1',
      change: {
        type: 'snapshot',
        conversationState: {
          requests: [{
            id: 'req-1',
            method: 'item/commandExecution/requestApproval',
            params: {
              turnId: 'turn-1',
              itemId: 'item-1',
              command: 'Get-Date',
              cwd: 'D:\\Research\\Project'
            }
          }]
        }
      }
    }
  }));
  const snapshot = await upserted;

  assert.equal(snapshot.threadId, 'thread-1');
  assert.equal(snapshot.requestId, 'req-1');
  assert.equal(snapshot.request.params.threadId, 'thread-1');
  assert.equal(snapshot.request.params.conversationId, 'thread-1');
  assert.equal(client.hasRequest('thread-1', 'req-1'), true);
  assert.equal(client.getOwnerClientId('thread-1'), 'owner-1');
  assert.equal(client.listRequests().length, 1);
  assert.equal(Array.isArray(client.getConversationState('thread-1').requests), true);

  client.close();
  socket.destroy();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(dir, { recursive: true, force: true });
});

test('desktop ipc emits requestRemoved when thread state patches remove a request', async () => {
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

  const upserted = new Promise((resolve) => client.once('requestUpserted', resolve));
  socket.write(frameFor({
    type: 'broadcast',
    method: 'thread-stream-state-changed',
    sourceClientId: 'owner-1',
    params: {
      conversationId: 'thread-1',
      change: {
        type: 'snapshot',
        conversationState: {
          requests: [{
            id: 'req-1',
            method: 'item/commandExecution/requestApproval',
            params: { turnId: 'turn-1', itemId: 'item-1', command: 'Get-Date' }
          }]
        }
      }
    }
  }));
  await upserted;

  const removed = new Promise((resolve) => client.once('requestRemoved', resolve));
  socket.write(frameFor({
    type: 'broadcast',
    method: 'thread-stream-state-changed',
    sourceClientId: 'owner-1',
    params: {
      conversationId: 'thread-1',
      change: {
        type: 'patches',
        patches: [{ op: 'remove', path: ['requests', 0] }]
      }
    }
  }));
  const snapshot = await removed;

  assert.equal(snapshot.threadId, 'thread-1');
  assert.equal(snapshot.requestId, 'req-1');
  assert.equal(snapshot.request.method, 'item/commandExecution/requestApproval');
  assert.equal(client.hasRequest('thread-1', 'req-1'), false);
  assert.equal(client.listRequests().length, 0);

  client.close();
  socket.destroy();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(dir, { recursive: true, force: true });
});

test('desktop ipc approval decision helpers target the desktop thread owner', async () => {
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

  const stateChanged = new Promise((resolve) => client.once('conversationStateChanged', resolve));
  socket.write(frameFor({
    type: 'broadcast',
    method: 'thread-stream-state-changed',
    sourceClientId: 'owner-1',
    params: {
      conversationId: 'thread-1',
      change: { type: 'snapshot', conversationState: { requests: [] } }
    }
  }));
  await stateChanged;

  const submitted = client.sendCommandApprovalDecision('thread-1', 'req-1', 'accept');
  const request = await readFrame(socket);
  socket.write(frameFor({
    type: 'response',
    requestId: request.requestId,
    resultType: 'success',
    method: 'thread-follower-command-approval-decision',
    result: { accepted: true }
  }));
  const result = await submitted;

  assert.deepEqual(result, { accepted: true });
  assert.equal(request.type, 'request');
  assert.equal(request.method, 'thread-follower-command-approval-decision');
  assert.equal(request.version, 1);
  assert.equal(request.targetClientId, 'owner-1');
  assert.deepEqual(request.params, {
    conversationId: 'thread-1',
    requestId: 'req-1',
    decision: 'accept'
  });

  client.close();
  socket.destroy();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(dir, { recursive: true, force: true });
});

test('desktop ipc approval decision helpers preserve non-numeric ids and coerce numeric ids', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmobile-ipc-test-'));
  const socketPath = testSocketPath(dir);
  const server = net.createServer();
  await new Promise((resolve) => server.listen(socketPath, resolve));
  let socket = null;
  let client = null;

  try {
    const accepted = new Promise((resolve) => server.once('connection', resolve));
    client = new DesktopIpcClient({ clientType: 'codexmobile-test', socketPath });
    const connected = client.connect({ timeoutMs: 1000 });
    socket = await accepted;
    const init = await readFrame(socket);
    socket.write(frameFor({
      type: 'response',
      requestId: init.requestId,
      resultType: 'success',
      method: 'initialize',
      result: { clientId: 'client-1' }
    }));
    await connected;

    const first = client.sendCommandApprovalDecision('thread-1', 'req-1', 'accept');
    const firstRequest = await readFrame(socket);
    socket.write(frameFor({
      type: 'response',
      requestId: firstRequest.requestId,
      resultType: 'success',
      method: 'thread-follower-command-approval-decision',
      result: { accepted: true }
    }));
    await first;

    const second = client.sendCommandApprovalDecision('thread-1', '101', 'accept');
    const secondRequest = await readFrame(socket);
    socket.write(frameFor({
      type: 'response',
      requestId: secondRequest.requestId,
      resultType: 'success',
      method: 'thread-follower-command-approval-decision',
      result: { accepted: true }
    }));
    await second;

    assert.equal(firstRequest.params.requestId, 'req-1');
    assert.equal(secondRequest.params.requestId, 101);
  } finally {
    client?.close();
    socket?.destroy();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
