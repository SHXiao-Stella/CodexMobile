import assert from 'node:assert/strict';
import test from 'node:test';

import {
  preferredProjectFromStoredSelection,
  rememberSelectedSession,
  selectedSessionFromStoredSelection
} from './app/selection-persistence.js';

test('startup prefers the stored project before the CodexMobile default project', () => {
  const projects = [
    { id: 'codexmobile', name: 'CodexMobile', path: '/repo/CodexMobile' },
    { id: 'normal', name: '普通对话', path: '' }
  ];

  const preferred = preferredProjectFromStoredSelection(projects, {
    storedProjectId: 'normal'
  });

  assert.equal(preferred.id, 'normal');
});

test('startup restores the stored session instead of jumping to the latest session', () => {
  const sessions = [
    { id: 'latest-thread', projectId: 'project-1', title: '最新对话' },
    { id: 'previous-thread', projectId: 'project-1', title: '刷新前的对话' }
  ];

  const selected = selectedSessionFromStoredSelection(sessions, {
    storedSessionId: 'previous-thread',
    chooseLatest: true
  });

  assert.equal(selected.id, 'previous-thread');
});

test('startup falls back to latest when the stored session is missing', () => {
  const sessions = [
    { id: 'latest-thread', projectId: 'project-1', title: '最新对话' },
    { id: 'older-thread', projectId: 'project-1', title: '旧对话' }
  ];

  const selected = selectedSessionFromStoredSelection(sessions, {
    storedSessionId: 'deleted-thread',
    chooseLatest: true
  });

  assert.equal(selected.id, 'latest-thread');
});

test('preserving the current selected session wins over stale stored selection', () => {
  const sessions = [
    { id: 'current-thread', projectId: 'project-1', title: '当前对话' },
    { id: 'stored-thread', projectId: 'project-1', title: '旧存储对话' }
  ];

  const selected = selectedSessionFromStoredSelection(sessions, {
    preserveSelection: true,
    currentSession: sessions[0],
    storedSessionId: 'stored-thread',
    chooseLatest: true
  });

  assert.equal(selected.id, 'current-thread');
});

test('preserving selection replaces stale draft flags on real session ids', () => {
  const sessions = [
    { id: 'current-thread', projectId: 'project-1', title: '褰撳墠瀵硅瘽' },
    { id: 'latest-thread', projectId: 'project-1', title: '鏈€鏂板璇?' }
  ];

  const selected = selectedSessionFromStoredSelection(sessions, {
    preserveSelection: true,
    currentSession: { id: 'current-thread', projectId: 'project-1', draft: true },
    chooseLatest: true
  });

  assert.equal(selected, sessions[0]);
});

test('rememberSelectedSession stores only real sessions, not drafts', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };

  rememberSelectedSession({ id: 'draft-project-1', projectId: 'project-1', draft: true }, storage);
  assert.equal(values.size, 0);

  rememberSelectedSession({ id: 'thread-1', projectId: 'project-1' }, storage);
  assert.equal(storage.getItem('codexmobile.selectedSessionId'), 'thread-1');
  assert.equal(storage.getItem('codexmobile.selectedProjectId'), 'project-1');
});

test('rememberSelectedSession stores real ids even when a stale draft flag remains', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };

  rememberSelectedSession({ id: 'thread-1', projectId: 'project-1', draft: true }, storage);

  assert.equal(storage.getItem('codexmobile.selectedSessionId'), 'thread-1');
  assert.equal(storage.getItem('codexmobile.selectedProjectId'), 'project-1');
});
