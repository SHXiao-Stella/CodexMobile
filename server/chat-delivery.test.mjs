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

test('desktop ipc send does not request a desktop thread refresh by default', async () => {
  const refreshes = [];

  await sendViaDesktopIpc(baseDesktopIpcSend({
    requestDesktopThreadSnapshotRefresh: async (conversationId) => {
      refreshes.push(conversationId);
      return { sent: true };
    }
  }));

  assert.deepEqual(refreshes, []);
});

test('desktop ipc can request a desktop thread refresh after accepted send when enabled', async () => {
  const refreshes = [];

  await sendViaDesktopIpc(baseDesktopIpcSend({
    refreshDesktopSnapshotAfterSend: true,
    requestDesktopThreadSnapshotRefresh: async (conversationId) => {
      refreshes.push(conversationId);
      return { sent: true };
    }
  }));

  assert.deepEqual(refreshes, ['thread-1']);
});

test('desktop ipc skips repeated model and reasoning sync when settings are unchanged', async () => {
  const settingsCache = new Map();
  const syncs = [];

  const base = {
    desktopFollowerSettingsCache: settingsCache,
    setDesktopFollowerModelAndReasoning: async (conversationId, model, reasoningEffort) => {
      syncs.push({ conversationId, model, reasoningEffort });
    }
  };

  await sendViaDesktopIpc(baseDesktopIpcSend(base));
  await sendViaDesktopIpc(baseDesktopIpcSend(base));

  assert.deepEqual(syncs, [
    { conversationId: 'thread-1', model: 'gpt-5.5', reasoningEffort: 'high' }
  ]);
});

test('desktop ipc syncs model and reasoning again when settings change', async () => {
  const settingsCache = new Map();
  const syncs = [];

  const base = {
    desktopFollowerSettingsCache: settingsCache,
    setDesktopFollowerModelAndReasoning: async (conversationId, model, reasoningEffort) => {
      syncs.push({ conversationId, model, reasoningEffort });
    }
  };

  await sendViaDesktopIpc(baseDesktopIpcSend(base));
  await sendViaDesktopIpc(baseDesktopIpcSend({
    ...base,
    reasoningEffort: 'xhigh'
  }));

  assert.deepEqual(syncs, [
    { conversationId: 'thread-1', model: 'gpt-5.5', reasoningEffort: 'high' },
    { conversationId: 'thread-1', model: 'gpt-5.5', reasoningEffort: 'xhigh' }
  ]);
});

test('desktop ipc clears cached plan collaboration mode before normal implementation turn', async () => {
  const collaborationCache = new Map();
  const syncs = [];
  const base = {
    desktopFollowerCollaborationModeCache: collaborationCache,
    setDesktopFollowerCollaborationMode: async (conversationId, collaborationMode) => {
      syncs.push({ conversationId, collaborationMode });
    }
  };

  await sendViaDesktopIpc(baseDesktopIpcSend({
    ...base,
    collaborationMode: {
      mode: 'plan',
      settings: {
        model: 'gpt-5.5',
        reasoning_effort: 'high',
        developer_instructions: null
      }
    }
  }));
  await sendViaDesktopIpc(baseDesktopIpcSend({
    ...base,
    codexMessage: 'PLEASE IMPLEMENT THIS PLAN:\n1. Do it',
    visibleMessage: '执行计划'
  }));

  assert.deepEqual(syncs, [
    {
      conversationId: 'thread-1',
      collaborationMode: {
        mode: 'plan',
        settings: {
          model: 'gpt-5.5',
          reasoning_effort: 'high',
          developer_instructions: null
        }
      }
    },
    { conversationId: 'thread-1', collaborationMode: null }
  ]);
});

test('desktop ipc clears plan collaboration mode for implementation prompts even without cache', async () => {
  const syncs = [];

  await sendViaDesktopIpc(baseDesktopIpcSend({
    codexMessage: 'PLEASE IMPLEMENT THIS PLAN:\n1. Do it',
    visibleMessage: '执行计划',
    setDesktopFollowerCollaborationMode: async (conversationId, collaborationMode) => {
      syncs.push({ conversationId, collaborationMode });
    }
  }));

  assert.deepEqual(syncs, [
    { conversationId: 'thread-1', collaborationMode: null }
  ]);
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
  const broadcasts = [];
  let attempts = 0;
  const sessionId = '019da0fa-e201-7a02-bec4-1bbc7d54da04';

  const result = await sendViaDesktopIpc(baseDesktopIpcSend({
    selectedSessionId: sessionId,
    broadcast: (payload) => broadcasts.push(payload),
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
  assert.deepEqual(
    broadcasts
      .filter((payload) => payload.type === 'status-update')
      .map((payload) => payload.label),
    ['正在打开桌面线程', '正在重试发送到桌面', '已交给桌面端处理']
  );
});

test('desktop ipc reports no client found without converting it to a background run', async () => {
  const broadcasts = [];
  const sessionId = '019da0fa-e201-7a02-bec4-1bbc7d54da04';

  await assert.rejects(
    () => sendViaDesktopIpc(baseDesktopIpcSend({
      selectedSessionId: sessionId,
      broadcast: (payload) => broadcasts.push(payload),
      startDesktopFollowerTurn: async () => {
        const error = new Error('no-client-found');
        error.statusCode = 409;
        throw error;
      },
      openDesktopThread: async () => ({ opened: true }),
      requestDesktopThreadSnapshotRefresh: async () => ({ sent: true })
    })),
    (error) => {
      assert.equal(error.code, 'CODEXMOBILE_DESKTOP_THREAD_OWNER_UNAVAILABLE');
      assert.equal(error.statusCode, 409);
      assert.match(error.message, /桌面端没有接管这个线程/);
      return true;
    }
  );

  assert.equal(
    broadcasts.some((payload) => payload.type === 'status-update' && payload.label === '发送失败：no client found'),
    true
  );
});
