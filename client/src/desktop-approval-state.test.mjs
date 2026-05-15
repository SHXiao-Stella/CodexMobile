import assert from 'node:assert/strict';
import test from 'node:test';
import {
  removePendingDesktopApproval,
  upsertPendingDesktopApproval
} from './desktop-approval-state.js';

test('upsertPendingDesktopApproval inserts and replaces approvals by id', () => {
  const first = upsertPendingDesktopApproval({ pendingApprovals: [] }, {
    id: 'thread-1:req-1',
    summary: 'Get-Date'
  });
  const second = upsertPendingDesktopApproval(first, {
    id: 'thread-1:req-1',
    summary: 'Get-Process'
  });

  assert.deepEqual(first.pendingApprovals, [{ id: 'thread-1:req-1', summary: 'Get-Date' }]);
  assert.deepEqual(second.pendingApprovals, [{ id: 'thread-1:req-1', summary: 'Get-Process' }]);
});

test('removePendingDesktopApproval removes approvals by id without touching other status fields', () => {
  const status = {
    connected: true,
    pendingApprovals: [
      { id: 'thread-1:req-1' },
      { id: 'thread-2:req-2' }
    ]
  };
  const next = removePendingDesktopApproval(status, 'thread-1:req-1');

  assert.equal(next.connected, true);
  assert.deepEqual(next.pendingApprovals, [{ id: 'thread-2:req-2' }]);
});
