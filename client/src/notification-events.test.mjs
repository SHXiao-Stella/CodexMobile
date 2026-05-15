import assert from 'node:assert/strict';
import test from 'node:test';
import {
  markUserInputMessageResolved,
  notificationFromPayload,
  payloadNeedsUserInput,
  shouldUseWebNotification,
  upsertUserInputMessage
} from './notification-events.js';

test('notificationFromPayload creates completion and failure toasts', () => {
  assert.deepEqual(notificationFromPayload({ type: 'chat-complete' }), {
    level: 'success',
    title: '任务已完成',
    body: 'Codex 已处理完当前任务。'
  });
  assert.deepEqual(notificationFromPayload({ type: 'chat-error', error: 'boom' }), {
    level: 'error',
    title: '任务失败',
    body: 'boom'
  });
});

test('payloadNeedsUserInput detects approval style status without matching normal streaming', () => {
  assert.equal(payloadNeedsUserInput({ type: 'status-update', label: '需要你确认权限' }), true);
  assert.equal(payloadNeedsUserInput({ type: 'activity-update', detail: 'waiting for user input' }), true);
  assert.equal(payloadNeedsUserInput({ type: 'status-update', label: '正在同步回复', status: 'running' }), false);
});

test('shouldUseWebNotification only fires when permission and context allow it', () => {
  assert.equal(shouldUseWebNotification({ enabled: true, permission: 'granted', visibilityState: 'hidden' }), true);
  assert.equal(shouldUseWebNotification({ enabled: true, permission: 'granted', visibilityState: 'visible', standalone: true }), true);
  assert.equal(shouldUseWebNotification({ enabled: true, permission: 'default', visibilityState: 'hidden' }), false);
  assert.equal(shouldUseWebNotification({ enabled: false, permission: 'granted', visibilityState: 'hidden' }), false);
});

test('notificationFromPayload reports desktop approval requests as user action', () => {
  const notification = notificationFromPayload({
    type: 'desktop-approval-request',
    kind: 'command',
    summary: 'Get-Date'
  });

  assert.equal(notification.level, 'warning');
  assert.equal(notification.title, '需要审批桌面权限');
  assert.equal(notification.body, 'Get-Date');
});

test('user input messages are upserted and marked answered by request identity', () => {
  const request = {
    type: 'user-input-request',
    threadId: 'thread-1',
    turnId: 'turn-1',
    itemId: 'item-1',
    questions: [{ id: 'choice', question: 'Continue?' }],
    timestamp: '2026-05-11T00:00:00.000Z'
  };
  const inserted = upsertUserInputMessage([], request);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].role, 'user_input_request');
  assert.equal(inserted[0].sessionId, 'thread-1');
  assert.equal(inserted[0].status, 'pending');

  const updated = markUserInputMessageResolved(inserted, request);
  assert.equal(updated[0].status, 'answered');
});
