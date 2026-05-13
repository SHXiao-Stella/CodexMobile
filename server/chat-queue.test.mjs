import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatQueue } from './chat-queue.js';

test('chat queue diagnostics expose counts without queued message content', () => {
  const queue = createChatQueue();
  queue.enqueueJob({
    queueKey: 'queue-1',
    turnId: 'turn-1',
    project: { id: 'project-1' },
    selectedSessionId: 'session-1',
    displayMessage: 'private prompt text',
    attachments: [{ name: 'private-file.png' }]
  });
  queue.rememberTurn('turn-1', {
    status: 'running',
    assistantPreview: 'private assistant text',
    usage: { inputTokens: 123 }
  });

  const diagnostics = queue.getDiagnostics();
  assert.equal(diagnostics.recentTurnCount, 1);
  assert.equal(diagnostics.conversationQueueCount, 1);
  assert.equal(diagnostics.queuedJobCount, 1);
  assert.equal(diagnostics.sessionAliasCount, 1);

  const serialized = JSON.stringify(diagnostics);
  assert.equal(serialized.includes('private prompt text'), false);
  assert.equal(serialized.includes('private assistant text'), false);
  assert.equal(serialized.includes('inputTokens'), false);
});
