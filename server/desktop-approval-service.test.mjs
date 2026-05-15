import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  createDesktopApprovalService,
  desktopApprovalId,
  mapDesktopApprovalDecision,
  normalizeDesktopApprovalRequest
} from './desktop-approval-service.js';

function commandSnapshot(overrides = {}) {
  return {
    threadId: 'thread-1',
    requestId: 'req-1',
    request: {
      id: 'req-1',
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-1',
        command: 'Get-Date',
        cwd: 'D:\\Research\\Project',
        reason: 'Need to run Get-Date',
        availableDecisions: ['accept', 'decline'],
        ...overrides
      }
    }
  };
}

test('normalizeDesktopApprovalRequest parses command approval requests', () => {
  const approval = normalizeDesktopApprovalRequest(commandSnapshot(), { now: () => 1_700_000_000_000 });

  assert.equal(approval.id, desktopApprovalId('thread-1', 'req-1'));
  assert.equal(approval.requestId, 'req-1');
  assert.equal(approval.threadId, 'thread-1');
  assert.equal(approval.turnId, 'turn-1');
  assert.equal(approval.itemId, 'item-1');
  assert.equal(approval.kind, 'command');
  assert.equal(approval.summary, 'Get-Date');
  assert.deepEqual(approval.display, {
    title: '需要批准命令',
    primary: 'Get-Date',
    secondary: 'D:\\Research\\Project'
  });
  assert.equal(approval.cwd, 'D:\\Research\\Project');
  assert.equal(approval.reason, 'Need to run Get-Date');
  assert.equal(approval.source, 'desktop-ipc');
  assert.equal(approval.actionable, true);
  assert.deepEqual(approval.availableDecisions, ['accept', 'decline']);
  assert.equal(approval.createdAt, new Date(1_700_000_000_000).toISOString());
});

test('normalizeDesktopApprovalRequest displays shell-wrapped commands by their inner command', () => {
  const approval = normalizeDesktopApprovalRequest(commandSnapshot({
    command: '"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command \'Get-Date -Format o\''
  }));
  const cmdApproval = normalizeDesktopApprovalRequest(commandSnapshot({
    command: '"C:\\Windows\\System32\\cmd.exe" /c "npm run test"'
  }));

  assert.equal(approval.summary, 'Get-Date -Format o');
  assert.deepEqual(approval.display, {
    title: '需要批准命令',
    primary: 'Get-Date -Format o',
    secondary: 'PowerShell · D:\\Research\\Project'
  });
  assert.equal(cmdApproval.summary, 'npm run test');
  assert.deepEqual(cmdApproval.display, {
    title: '需要批准命令',
    primary: 'npm run test',
    secondary: 'CMD · D:\\Research\\Project'
  });
});

test('normalizeDesktopApprovalRequest parses file and permissions approvals', () => {
  const fileApproval = normalizeDesktopApprovalRequest({
    threadId: 'thread-1',
    requestId: 'file-1',
    request: {
      id: 'file-1',
      method: 'item/fileChange/requestApproval',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'patch-1',
        reason: 'Edit app.js',
        cwd: 'D:\\Research\\Project'
      }
    }
  });
  const permissionsApproval = normalizeDesktopApprovalRequest({
    threadId: 'thread-2',
    requestId: 'perm-1',
    request: {
      id: 'perm-1',
      method: 'item/permissions/requestApproval',
      params: {
        threadId: 'thread-2',
        turnId: 'turn-2',
        itemId: 'perm-item',
        reason: 'Need network',
        permissions: { networkAccess: true }
      }
    }
  });

  assert.equal(fileApproval.kind, 'file');
  assert.equal(fileApproval.summary, 'Edit app.js');
  assert.deepEqual(fileApproval.display, {
    title: '需要批准文件修改',
    primary: 'Edit app.js',
    secondary: 'D:\\Research\\Project'
  });
  assert.equal(permissionsApproval.kind, 'permissions');
  assert.equal(permissionsApproval.summary, 'Need network');
  assert.deepEqual(permissionsApproval.display, {
    title: '需要批准权限',
    primary: 'Need network',
    secondary: ''
  });
  assert.deepEqual(permissionsApproval.permissions, { networkAccess: true });
});

test('mapDesktopApprovalDecision maps approve and deny decisions by kind', () => {
  const commandApproval = normalizeDesktopApprovalRequest(commandSnapshot());
  const wrappedCommandApproval = normalizeDesktopApprovalRequest(commandSnapshot({
    availableDecisions: [
      { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['npm', 'run', 'test'] } },
      'decline'
    ]
  }));
  const fileApproval = normalizeDesktopApprovalRequest({
    threadId: 'thread-1',
    requestId: 'file-1',
    request: {
      id: 'file-1',
      method: 'item/fileChange/requestApproval',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'file-1',
        reason: 'Edit file',
        availableDecisions: ['accept', 'cancel']
      }
    }
  });
  const permissionsApproval = normalizeDesktopApprovalRequest({
    threadId: 'thread-1',
    requestId: 'perm-1',
    request: {
      id: 'perm-1',
      method: 'item/permissions/requestApproval',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'perm-1',
        permissions: { networkAccess: true }
      }
    }
  });

  assert.deepEqual(mapDesktopApprovalDecision(commandApproval, 'approve'), {
    route: 'command',
    payload: 'accept'
  });
  assert.deepEqual(mapDesktopApprovalDecision(commandApproval, 'deny'), {
    route: 'command',
    payload: 'decline'
  });
  assert.deepEqual(wrappedCommandApproval.availableDecisions, ['acceptWithExecpolicyAmendment', 'decline']);
  assert.deepEqual(mapDesktopApprovalDecision(wrappedCommandApproval, 'approve'), {
    route: 'command',
    payload: { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['npm', 'run', 'test'] } }
  });
  assert.deepEqual(mapDesktopApprovalDecision(fileApproval, 'deny'), {
    route: 'file',
    payload: 'cancel'
  });
  assert.deepEqual(mapDesktopApprovalDecision(permissionsApproval, 'approve'), {
    route: 'permissions',
    payload: { permissions: { networkAccess: true }, scope: 'turn' }
  });
  assert.deepEqual(mapDesktopApprovalDecision(permissionsApproval, 'deny'), {
    route: 'permissions',
    payload: { permissions: {}, scope: 'turn' }
  });
});

test('desktop approval service sends decisions and removes resolved approvals', async () => {
  const broadcasts = [];
  const calls = [];
  const client = new EventEmitter();
  client.isReady = () => true;
  client.sendCommandApprovalDecision = async (...args) => {
    calls.push(args);
    return { accepted: true };
  };
  const service = createDesktopApprovalService({
    client,
    logger: null,
    broadcast: (payload) => broadcasts.push(payload)
  });

  service.handleRequestUpserted(commandSnapshot());
  const approval = service.listPending()[0];
  const result = await service.decide(approval.id, 'approve');

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [['thread-1', 'req-1', 'accept']]);
  assert.equal(service.listPending().length, 0);
  assert.equal(broadcasts.some((payload) => payload.type === 'desktop-approval-request'), true);
  assert.equal(broadcasts.some((payload) => payload.type === 'desktop-approval-resolved'), true);
});

test('desktop approval service sends original wrapped decision payloads', async () => {
  const calls = [];
  const client = new EventEmitter();
  client.isReady = () => true;
  client.sendCommandApprovalDecision = async (...args) => {
    calls.push(args);
    return { accepted: true };
  };
  const service = createDesktopApprovalService({ client, logger: null, broadcast: () => {} });

  service.handleRequestUpserted(commandSnapshot({
    availableDecisions: [
      { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['npm', 'run', 'test'] } },
      'decline'
    ]
  }));
  const approval = service.listPending()[0];
  const result = await service.decide(approval.id, 'approve');

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [[
    'thread-1',
    'req-1',
    { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['npm', 'run', 'test'] } }
  ]]);
});

test('desktop approval service marks removed desktop requests as stale', () => {
  const broadcasts = [];
  const service = createDesktopApprovalService({
    client: new EventEmitter(),
    logger: null,
    broadcast: (payload) => broadcasts.push(payload)
  });

  service.handleRequestUpserted(commandSnapshot());
  service.handleRequestRemoved({
    threadId: 'thread-1',
    requestId: 'req-1',
    request: commandSnapshot().request
  });

  assert.equal(service.listPending().length, 0);
  assert.equal(broadcasts.at(-1).type, 'desktop-approval-stale');
  assert.equal(broadcasts.at(-1).id, desktopApprovalId('thread-1', 'req-1'));
});

test('desktop approval service removes stale failures but keeps transient timeout failures', async () => {
  const staleClient = new EventEmitter();
  staleClient.isReady = () => true;
  staleClient.sendCommandApprovalDecision = async () => {
    const error = new Error('no-client-found');
    error.statusCode = 409;
    throw error;
  };
  const staleService = createDesktopApprovalService({ client: staleClient, logger: null, broadcast: () => {} });
  staleService.handleRequestUpserted(commandSnapshot());

  const staleResult = await staleService.decide(desktopApprovalId('thread-1', 'req-1'), 'approve');

  assert.deepEqual(staleResult, {
    ok: false,
    reason: 'stale',
    code: 'desktop_approval_stale',
    error: '桌面端已处理这条审批'
  });
  assert.equal(staleService.listPending().length, 0);

  const timeoutClient = new EventEmitter();
  timeoutClient.isReady = () => true;
  timeoutClient.sendCommandApprovalDecision = async () => {
    const error = new Error('Timed out waiting for Codex Desktop IPC response');
    error.code = 'CODEXMOBILE_DESKTOP_IPC_TIMEOUT';
    throw error;
  };
  const timeoutService = createDesktopApprovalService({ client: timeoutClient, logger: null, broadcast: () => {} });
  timeoutService.handleRequestUpserted(commandSnapshot());

  const timeoutResult = await timeoutService.decide(desktopApprovalId('thread-1', 'req-1'), 'approve');

  assert.equal(timeoutResult.ok, false);
  assert.equal(timeoutResult.reason, 'transient');
  assert.equal(timeoutResult.code, 'desktop_approval_transient');
  assert.equal(timeoutResult.error, '桌面端连接中断或超时，请稍后重试');
  assert.equal(timeoutService.listPending().length, 1);
});

test('desktop approval service reports missing and failed decisions with friendly codes', async () => {
  const service = createDesktopApprovalService({
    client: new EventEmitter(),
    logger: null,
    broadcast: () => {}
  });

  assert.deepEqual(await service.decide(desktopApprovalId('thread-1', 'missing'), 'approve'), {
    ok: false,
    reason: 'not-found',
    code: 'desktop_approval_not_found',
    error: '审批请求已过期'
  });

  const failedClient = new EventEmitter();
  failedClient.isReady = () => true;
  failedClient.sendCommandApprovalDecision = async () => {
    throw new Error('Desktop rejected decision payload');
  };
  const failedService = createDesktopApprovalService({ client: failedClient, logger: null, broadcast: () => {} });
  failedService.handleRequestUpserted(commandSnapshot());

  const failedResult = await failedService.decide(desktopApprovalId('thread-1', 'req-1'), 'approve');

  assert.equal(failedResult.ok, false);
  assert.equal(failedResult.reason, 'failed');
  assert.equal(failedResult.code, 'desktop_approval_failed');
  assert.equal(failedResult.error, '审批发送失败，请在电脑端处理');
});
