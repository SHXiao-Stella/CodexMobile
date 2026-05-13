import assert from 'node:assert/strict';
import test from 'node:test';
import { sendViaDesktopIpc } from './chat-delivery.js';

function baseDesktopIpcSend(overrides = {}) {
  return {
    bridge: { mode: 'desktop-ipc' },
    project: { id: 'project-1', path: 'D:\\Research\\Project' },
    selectedSessionId: 'thread-1',
    draftSessionId: null,
    turnId: 'client-turn-1',
    sendMode: 'start',
    codexMessage: 'hello',
    visibleMessage: 'hello',
    attachments: [],
    selectedSkills: [],
    model: 'gpt-5.5',
    reasoningEffort: 'high',
    serviceTier: null,
    permissionMode: 'default',
    collaborationMode: null,
    getSession: () => ({ cwd: 'D:\\Research\\Project' }),
    rememberTurn: () => {},
    broadcast: () => {},
    setDesktopFollowerModelAndReasoning: async () => {},
    setDesktopFollowerCollaborationMode: async () => {},
    startDesktopFollowerTurn: async () => ({ result: { turn: { id: 'desktop-turn-1' } } }),
    steerDesktopFollowerTurn: async () => ({ result: { turn: { id: 'desktop-turn-1' } } }),
    interruptDesktopFollowerTurn: async () => {},
    sleep: async () => {},
    ...overrides
  };
}

test('desktop ipc send broadcasts a desktop thread refresh after accepted start', async () => {
  const refreshes = [];

  await sendViaDesktopIpc(baseDesktopIpcSend({
    requestDesktopThreadSnapshotRefresh: async (conversationId) => {
      refreshes.push(conversationId);
      return { sent: true };
    }
  }));

  assert.deepEqual(refreshes, ['thread-1']);
});

test('desktop ipc steer broadcasts a desktop thread refresh after accepted steer', async () => {
  const refreshes = [];

  await sendViaDesktopIpc(baseDesktopIpcSend({
    sendMode: 'steer',
    requestDesktopThreadSnapshotRefresh: async (conversationId) => {
      refreshes.push(conversationId);
      return { sent: true };
    }
  }));

  assert.deepEqual(refreshes, ['thread-1']);
});

test('desktop ipc default permission sends a complete workspaceWrite sandbox policy', async () => {
  let receivedParams = null;

  await sendViaDesktopIpc(baseDesktopIpcSend({
    startDesktopFollowerTurn: async (_conversationId, params) => {
      receivedParams = params;
      return { result: { turn: { id: 'desktop-turn-1' } } };
    },
    requestDesktopThreadSnapshotRefresh: async () => ({ sent: true })
  }));

  assert.deepEqual(receivedParams.sandboxPolicy, {
    type: 'workspaceWrite',
    writableRoots: [],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false
  });
});

test('desktop ipc opens the desktop thread deeplink before retrying a missing owner', async () => {
  const opened = [];
  const sleeps = [];
  let attempts = 0;
  const sessionId = '019da0fa-e201-7a02-bec4-1bbc7d54da04';

  const result = await sendViaDesktopIpc(baseDesktopIpcSend({
    selectedSessionId: sessionId,
    startDesktopFollowerTurn: async () => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error('no-client-found');
        error.statusCode = 409;
        throw error;
      }
      return { result: { turn: { id: 'desktop-turn-after-open' } } };
    },
    openDesktopThread: async (conversationId) => {
      opened.push(conversationId);
      return { opened: true, url: `codex://threads/${conversationId}` };
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    requestDesktopThreadSnapshotRefresh: async () => ({ sent: true })
  }));

  assert.equal(result.turnId, 'desktop-turn-after-open');
  assert.deepEqual(opened, [sessionId]);
  assert.deepEqual(sleeps, [900]);
  assert.equal(attempts, 2);
});
