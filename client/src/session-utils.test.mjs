import assert from 'node:assert/strict';
import test from 'node:test';

import { isDraftSession } from './app/session-utils.js';

test('isDraftSession only treats draft-prefixed ids as drafts', () => {
  assert.equal(isDraftSession({ id: 'draft-project-1', draft: true }), true);
  assert.equal(isDraftSession('draft-project-1'), true);
  assert.equal(isDraftSession({ id: 'thread-1', draft: true }), false);
  assert.equal(isDraftSession({ id: 'thread-1' }), false);
});
