import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PendingUserInputRequests,
  normalizeDesktopUserInputSubmission,
  normalizeUserInputAnswers,
  normalizeUserInputRequest,
  userInputRequestKey
} from './user-input-requests.js';

const requestMessage = {
  method: 'item/tool/requestUserInput',
  params: {
    threadId: 'thread-1',
    turnId: 'turn-1',
    itemId: 'item-1',
    conversationId: 'desktop-thread-1',
    questions: [
      {
        id: 'choice',
        header: 'Decision',
        question: 'Pick one',
        options: [{ label: 'A', description: 'First option' }]
      },
      {
        id: 'note',
        question: 'Any note?',
        isOther: true,
        isSecret: true
      }
    ]
  }
};

test('normalizeUserInputRequest parses app-server user input requests', () => {
  assert.deepEqual(normalizeUserInputRequest(requestMessage), {
    threadId: 'thread-1',
    turnId: 'turn-1',
    itemId: 'item-1',
    conversationId: 'desktop-thread-1',
    questions: [
      {
        id: 'choice',
        header: 'Decision',
        question: 'Pick one',
        isOther: false,
        isSecret: false,
        options: [{ label: 'A', description: 'First option' }]
      },
      {
        id: 'note',
        header: '',
        question: 'Any note?',
        isOther: true,
        isSecret: true,
        options: null
      }
    ]
  });
});

test('normalizeUserInputAnswers keeps protocol answer arrays', () => {
  assert.deepEqual(normalizeUserInputAnswers({
    choice: { answers: ['A'] },
    note: 'typed text',
    empty: { answers: [] }
  }), {
    answers: {
      choice: { answers: ['A'] },
      note: { answers: ['typed text'] },
      empty: { answers: [] }
    }
  });
});

test('PendingUserInputRequests stores, answers, and clears requests', async () => {
  const pending = new PendingUserInputRequests({ now: () => 123 });
  let resolved = null;
  const { key, request } = pending.add(requestMessage, (value) => {
    resolved = value;
  });

  assert.equal(key, userInputRequestKey(request));
  assert.equal(pending.list().length, 1);
  assert.equal(pending.list()[0].createdAt, 123);
  assert.deepEqual(pending.getDiagnostics(), {
    pendingCount: 1,
    pendingByThread: { 'thread-1': 1 }
  });

  const result = pending.answer({
    threadId: 'thread-1',
    turnId: 'turn-1',
    itemId: 'item-1',
    answers: { choice: { answers: ['A'] } }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(resolved, { answers: { choice: { answers: ['A'] } } });
  assert.equal(pending.list().length, 0);
  assert.deepEqual(pending.answer({
    threadId: 'thread-1',
    turnId: 'turn-1',
    itemId: 'missing'
  }), { ok: false, reason: 'not-found' });
});

test('normalizeDesktopUserInputSubmission extracts desktop IPC fallback requests', () => {
  assert.deepEqual(normalizeDesktopUserInputSubmission({
    conversationId: 'desktop-thread-1',
    sessionId: 'thread-1',
    turnId: 'turn-1',
    itemId: 'item-1',
    answers: { choice: 'A' }
  }), {
    conversationId: 'desktop-thread-1',
    threadId: 'thread-1',
    turnId: 'turn-1',
    itemId: 'item-1',
    response: { answers: { choice: { answers: ['A'] } } }
  });
  assert.equal(normalizeDesktopUserInputSubmission({}), null);
});
