import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const mojibakePattern = /妗岄潰|骞挎挱|澶辫触|涓嶅瓨|鏃犳硶|瀹℃壒|�/;

async function listRuntimeSources(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listRuntimeSources(fullPath));
    } else if (/\.(?:js|mjs)$/.test(entry.name) && !entry.name.endsWith('.test.mjs')) {
      files.push(fullPath);
    }
  }
  return files;
}

test('server runtime text does not contain known mojibake fragments', async () => {
  const offenders = [];
  for (const filePath of await listRuntimeSources(serverDir)) {
    const text = await fs.readFile(filePath, 'utf8');
    if (mojibakePattern.test(text)) {
      offenders.push(path.relative(serverDir, filePath));
    }
  }

  assert.deepEqual(offenders, []);
});
