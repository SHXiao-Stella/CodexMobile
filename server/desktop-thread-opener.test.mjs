import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { buildCodexThreadUrl, openCodexDesktopThread } from './desktop-thread-opener.js';

const THREAD_ID = '019da0fa-e201-7a02-bec4-1bbc7d54da04';

test('buildCodexThreadUrl creates Codex Desktop thread deeplinks for UUID ids', () => {
  assert.equal(buildCodexThreadUrl(THREAD_ID), `codex://threads/${THREAD_ID}`);
  assert.equal(buildCodexThreadUrl('thread-1'), null);
});

test('openCodexDesktopThread opens Windows codex thread deeplink without a visible console', async () => {
  const child = new EventEmitter();
  let unrefCalled = false;
  child.unref = () => {
    unrefCalled = true;
  };
  let call = null;

  const opening = openCodexDesktopThread(THREAD_ID, {
    platform: 'win32',
    spawnImpl: (command, args, options) => {
      call = { command, args, options };
      queueMicrotask(() => child.emit('spawn'));
      return child;
    }
  });

  assert.deepEqual(await opening, { opened: true, url: `codex://threads/${THREAD_ID}` });
  assert.equal(call.command, 'rundll32.exe');
  assert.deepEqual(call.args, ['url.dll,FileProtocolHandler', `codex://threads/${THREAD_ID}`]);
  assert.equal(call.options.windowsHide, true);
  assert.equal(unrefCalled, true);
});

test('openCodexDesktopThread reports invalid ids without spawning', async () => {
  let spawned = false;

  const result = await openCodexDesktopThread('thread-1', {
    platform: 'win32',
    spawnImpl: () => {
      spawned = true;
    }
  });

  assert.deepEqual(result, { opened: false, reason: 'invalid-conversation-id' });
  assert.equal(spawned, false);
});
