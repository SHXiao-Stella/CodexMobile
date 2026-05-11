import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  CODEXMOBILE_SERVICE_ARG,
  commandMatchesCodexMobileServer,
  pidRecordIdentifiesListener,
  pidRecordMatchesService,
  serviceChildPath
} from './codexmobile-service.mjs';

const root = path.resolve('D:/Research/0MktLB/Code/CodexMobile-deploy/CodexMobile');

test('command matcher requires the service name for named CodexMobile processes', () => {
  const command = `"C:\\Program Files\\nodejs\\node.exe" "${root}\\server\\index.js" ${CODEXMOBILE_SERVICE_ARG}`;

  assert.equal(commandMatchesCodexMobileServer(command, { root, requireServiceName: true }), true);
  assert.equal(commandMatchesCodexMobileServer(command.replace(CODEXMOBILE_SERVICE_ARG, ''), {
    root,
    requireServiceName: true
  }), false);
});

test('command matcher rejects same port processes from other projects', () => {
  const command = `"C:\\Program Files\\nodejs\\node.exe" "D:\\Other\\CodexMobile\\server\\index.js" ${CODEXMOBILE_SERVICE_ARG}`;

  assert.equal(commandMatchesCodexMobileServer(command, { root, requireServiceName: true }), false);
});

test('command matcher can still recognize current-project legacy server commands', () => {
  const command = `"C:\\Program Files\\nodejs\\node.exe" "${root}\\server\\index.js"`;

  assert.equal(commandMatchesCodexMobileServer(command, { root, allowLegacy: true }), true);
  assert.equal(commandMatchesCodexMobileServer(command, { root, allowLegacy: false }), false);
});

test('pid record must match service name, root, port, and pid', () => {
  assert.equal(pidRecordMatchesService({
    pid: 1234,
    serviceName: 'codexmobile',
    root,
    port: 3321
  }, { pid: 1234, root, port: 3321 }), true);

  assert.equal(pidRecordMatchesService({
    pid: 1234,
    serviceName: 'other',
    root,
    port: 3321
  }, { pid: 1234, root, port: 3321 }), false);
});

test('pid record can identify a listener without reading process command line', () => {
  const record = {
    pid: 1234,
    serviceName: 'codexmobile',
    root,
    port: 3321
  };

  assert.equal(pidRecordIdentifiesListener(record, {
    root,
    port: 3321,
    listenerPids: [1234]
  }), true);
  assert.equal(pidRecordIdentifiesListener(record, {
    root,
    port: 3321,
    listenerPids: [5678]
  }), false);
});

test('service child path prepends the node executable directory for bundled Codex tools', () => {
  const execPath = 'C:\\Users\\Shuhua\\AppData\\Local\\OpenAI\\Codex\\bin\\node.exe';
  const result = serviceChildPath('C:\\Windows\\System32;C:\\Tools', execPath);

  assert.equal(result.split(path.delimiter)[0], 'C:\\Users\\Shuhua\\AppData\\Local\\OpenAI\\Codex\\bin');
  assert.equal(result.includes('C:\\Windows\\System32'), true);
});
