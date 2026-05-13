import assert from 'node:assert/strict';
import test from 'node:test';
import { composerSendState, composerSubmitAction, newConversationState } from './send-state.js';

test('composerSendState blocks sending when the desktop bridge is unavailable', () => {
  const state = composerSendState({
    hasInput: true,
    desktopBridge: { connected: false, mode: 'unavailable' }
  });

  assert.equal(state.disabled, true);
  assert.equal(state.mode, 'unavailable');
  assert.equal(state.label, '桌面端 Codex 未连接');
});

test('composerSendState starts a desktop turn when idle', () => {
  const state = composerSendState({
    hasInput: true,
    desktopBridge: { connected: true, mode: 'desktop-proxy', capabilities: { createThread: true } },
    sessionIsDraft: true
  });

  assert.equal(state.disabled, false);
  assert.equal(state.mode, 'start');
  assert.equal(state.showMenu, false);
});

test('composerSendState defaults running input to steer when possible', () => {
  const state = composerSendState({
    running: true,
    hasInput: true,
    steerable: true,
    desktopBridge: { connected: true, mode: 'desktop-proxy' }
  });

  assert.equal(state.mode, 'steer');
  assert.equal(state.showMenu, true);
  assert.equal(state.canSteer, true);
});

test('composerSendState preserves queue and interrupt when active turn cannot steer', () => {
  const state = composerSendState({
    running: true,
    hasInput: true,
    steerable: false,
    desktopBridge: { connected: true, mode: 'desktop-proxy' }
  });

  assert.equal(state.mode, 'queue');
  assert.equal(state.canSteer, false);
  assert.equal(state.canQueue, true);
  assert.equal(state.canInterrupt, true);
});

test('composerSendState blocks draft sends when desktop direct creation is unavailable', () => {
  const state = composerSendState({
    hasInput: true,
    sessionIsDraft: true,
    desktopBridge: {
      connected: true,
      mode: 'desktop-ipc',
      capabilities: { sendToOpenDesktopThread: true, createThread: false }
    }
  });

  assert.equal(state.disabled, true);
  assert.equal(state.mode, 'create-unavailable');
  assert.equal(state.label, '请先在电脑端新建/打开线程');
});

test('composerSendState still allows existing desktop threads when createThread is unavailable', () => {
  const state = composerSendState({
    hasInput: true,
    hasSelectedSession: true,
    sessionIsDraft: false,
    desktopBridge: {
      connected: true,
      mode: 'desktop-ipc',
      capabilities: { sendToOpenDesktopThread: true, createThread: false }
    }
  });

  assert.equal(state.disabled, false);
  assert.equal(state.mode, 'start');
});

test('composerSendState requires an explicit selected desktop thread for normal desktop IPC sends', () => {
  const state = composerSendState({
    hasInput: true,
    hasSelectedSession: false,
    sessionIsDraft: false,
    desktopBridge: {
      connected: true,
      mode: 'desktop-ipc',
      capabilities: {
        sendToOpenDesktopThread: true,
        createThread: false,
        backgroundCodex: true,
        createThreadViaBackground: true
      }
    }
  });

  assert.equal(state.disabled, true);
  assert.equal(state.mode, 'no-active-thread');
  assert.equal(state.label, '请先选择桌面线程');
});

test('composerSendState allows draft sends in headless local mode', () => {
  const state = composerSendState({
    hasInput: true,
    hasSelectedSession: true,
    sessionIsDraft: true,
    desktopBridge: {
      connected: true,
      mode: 'headless-local',
      capabilities: { createThread: true }
    }
  });

  assert.equal(state.disabled, false);
  assert.equal(state.mode, 'start');
});

test('composerSendState blocks draft sends through desktop background fallback', () => {
  const state = composerSendState({
    hasInput: true,
    hasSelectedSession: true,
    sessionIsDraft: true,
    desktopBridge: {
      connected: true,
      mode: 'desktop-ipc',
      capabilities: {
        createThread: false,
        backgroundCodex: true,
        createThreadViaBackground: true
      }
    }
  });

  assert.equal(state.disabled, true);
  assert.equal(state.mode, 'create-unavailable');
  assert.equal(state.label, '请先在电脑端新建/打开线程');
});

test('newConversationState blocks mobile-created desktop IPC threads with a user-facing reason', () => {
  const state = newConversationState({
    desktopBridge: {
      connected: true,
      mode: 'desktop-ipc',
      capabilities: {
        createThread: false,
        createThreadReason: '请先在电脑端新建或打开线程，然后从手机继续发送。',
        backgroundCodex: true,
        createThreadViaBackground: true
      }
    }
  });

  assert.equal(state.disabled, true);
  assert.equal(state.mode, 'create-unavailable');
  assert.match(state.reason, /请先在电脑端新建或打开线程/);
});

test('newConversationState allows explicit headless local new threads', () => {
  const state = newConversationState({
    desktopBridge: {
      connected: true,
      mode: 'headless-local',
      capabilities: { createThread: true }
    }
  });

  assert.equal(state.disabled, false);
  assert.equal(state.mode, 'available');
});

test('composerSubmitAction sends directly to a steerable running task', () => {
  assert.deepEqual(
    composerSubmitAction({
      runningInputMode: true,
      hasInput: true,
      sendState: { mode: 'steer', canSteer: true }
    }),
    { type: 'submit', mode: 'steer' }
  );
});

test('composerSubmitAction keeps the send-mode menu for non-steerable running tasks', () => {
  assert.deepEqual(
    composerSubmitAction({
      runningInputMode: true,
      hasInput: true,
      sendState: { mode: 'queue', canSteer: false }
    }),
    { type: 'menu' }
  );
});
