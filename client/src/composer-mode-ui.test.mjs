import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('composer mode button keeps mode text out of the compact control', async () => {
  const source = await readFile(new URL('./composer/Composer.jsx', import.meta.url), 'utf8');
  assert.match(source, /aria-label=\{`Mode: \$\{composerModeLabel\(composerMode\)\}`\}/);
  assert.match(source, /title=\{`Mode: \$\{composerModeLabel\(composerMode\)\}`\}/);
  assert.doesNotMatch(source, /<span>\{composerModeLabel\(composerMode\)\}<\/span>/);
});
