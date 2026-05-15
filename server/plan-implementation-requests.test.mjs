import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PendingPlanImplementationRequests,
  normalizePlanImplementationDecision,
  normalizePlanImplementationRequest,
  planImplementationRequestKey
} from './plan-implementation-requests.js';

const requestMessage = {
  id: 'plan-request-1',
  method: 'item/plan/requestImplementation',
  params: {
    threadId: 'thread-1',
    turnId: 'turn-1',
    planContent: '1. Do it'
  }
};

test('normalizePlanImplementationRequest parses app-server plan implementation requests', () => {
  assert.deepEqual(normalizePlanImplementationRequest(requestMessage), {
    threadId: 'thread-1',
    turnId: 'turn-1',
    itemId: 'plan-request-1',
    requestId: 'plan-request-1',
    planContent: '1. Do it',
    source: 'codex-app-server'
  });
});

test('normalizePlanImplementationDecision maps approvals and denials to app-server decisions', () => {
  assert.deepEqual(normalizePlanImplementationDecision({ decision: 'approve' }), { decision: 'accept' });
  assert.deepEqual(normalizePlanImplementationDecision({ decision: 'implement' }), { decision: 'accept' });
  assert.deepEqual(normalizePlanImplementationDecision({ decision: 'deny' }), { decision: 'decline' });
});

test('PendingPlanImplementationRequests stores, answers, and clears requests', () => {
  const pending = new PendingPlanImplementationRequests({ now: () => 123 });
  let resolved = null;
  const { key, request } = pending.add(requestMessage, (value) => {
    resolved = value;
  });

  assert.equal(key, planImplementationRequestKey(request));
  assert.deepEqual(pending.getDiagnostics(), {
    pendingCount: 1,
    pendingByThread: { 'thread-1': 1 }
  });

  const result = pending.answer({
    threadId: 'thread-1',
    turnId: 'turn-1',
    itemId: 'plan-request-1',
    decision: 'accept'
  });

  assert.equal(result.ok, true);
  assert.deepEqual(resolved, { decision: 'accept' });
  assert.deepEqual(pending.answer({
    threadId: 'thread-1',
    turnId: 'turn-1',
    itemId: 'missing',
    decision: 'accept'
  }), { ok: false, reason: 'not-found' });
});

test('PendingPlanImplementationRequests resolves cleared requests as declined', () => {
  const pending = new PendingPlanImplementationRequests();
  let resolved = null;
  pending.add(requestMessage, (value) => {
    resolved = value;
  });

  const cleared = pending.clearForTurn({ threadId: 'thread-1', turnId: 'turn-1' });

  assert.equal(cleared.length, 1);
  assert.deepEqual(resolved, { decision: 'decline' });
  assert.deepEqual(pending.getDiagnostics(), {
    pendingCount: 0,
    pendingByThread: {}
  });
});
