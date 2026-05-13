import assert from 'node:assert/strict';
import test from 'node:test';
import { bridgeConnectionLabel } from './panels/topbar-status.js';

test('bridgeConnectionLabel shows selected desktop IPC thread as connected desktop thread', () => {
  const label = bridgeConnectionLabel('connected', {
    connected: true,
    mode: 'desktop-ipc'
  }, {
    selectedSession: { id: 'thread-1' }
  });

  assert.equal(label.label, '已连接桌面当前线程');
  assert.match(label.description, /手机消息会发送到 Codex Desktop 当前线程/);
});

test('bridgeConnectionLabel shows desktop IPC with no active thread', () => {
  const label = bridgeConnectionLabel('connected', {
    connected: true,
    mode: 'desktop-ipc'
  }, {
    selectedSession: null
  });

  assert.equal(label.label, '桌面已连接，但没有活动线程');
  assert.match(label.description, /请先在电脑端新建或打开线程/);
});

test('bridgeConnectionLabel distinguishes desktop and background running routes', () => {
  assert.equal(
    bridgeConnectionLabel('connected', { connected: true, mode: 'desktop-ipc' }, {
      selectedSession: { id: 'thread-1' },
      selectedRuntime: { status: 'running', source: 'desktop-ipc' }
    }).label,
    '桌面运行中'
  );

  assert.equal(
    bridgeConnectionLabel('connected', { connected: true, mode: 'desktop-ipc' }, {
      selectedSession: { id: 'thread-1' },
      selectedRuntime: { status: 'running', source: 'headless-local' }
    }).label,
    '后台运行中'
  );
});

test('bridgeConnectionLabel avoids claiming IPC route before running source is known', () => {
  const label = bridgeConnectionLabel('connected', { connected: true, mode: 'desktop-ipc' }, {
    selectedSession: { id: 'thread-1' },
    selectedRuntime: { status: 'running' }
  });

  assert.equal(label.label, '运行确认中');
  assert.match(label.description, /正在确认/);
});

test('bridgeConnectionLabel uses compact background and disconnected labels', () => {
  assert.equal(
    bridgeConnectionLabel('connected', { connected: true, mode: 'headless-local' }).label,
    '后台可用'
  );

  assert.equal(
    bridgeConnectionLabel('connected', { connected: false, mode: 'unavailable' }).label,
    '桌面未连接'
  );
});
