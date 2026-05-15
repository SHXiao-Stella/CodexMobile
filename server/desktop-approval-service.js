import { DesktopIpcClient } from './desktop-ipc-client.js';

const SUPPORTED_METHODS = new Map([
  ['item/commandExecution/requestApproval', 'command'],
  ['item/fileChange/requestApproval', 'file'],
  ['item/permissions/requestApproval', 'permissions']
]);

function stringOrEmpty(value) {
  return String(value || '').trim();
}

function clone(value) {
  if (value === undefined) {
    return undefined;
  }
  return structuredClone(value);
}

function normalizeDecisionSpecs(rawDecisions) {
  const rawList = Array.isArray(rawDecisions) ? rawDecisions : [];
  const specs = [];
  const seen = new Set();
  for (const raw of rawList) {
    if (typeof raw === 'string' && raw.trim()) {
      const key = raw.trim();
      if (!seen.has(key)) {
        specs.push({ key, payload: key });
        seen.add(key);
      }
      continue;
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      continue;
    }
    const keys = Object.keys(raw).filter((key) => key.trim());
    if (keys.length === 1) {
      const key = keys[0];
      if (!seen.has(key)) {
        specs.push({ key, payload: clone({ [key]: raw[key] }) });
        seen.add(key);
      }
    }
  }
  return specs;
}

function splitCommandLine(value) {
  const input = stringOrEmpty(value);
  const tokens = [];
  let current = '';
  let quote = null;

  for (const char of input) {
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function commandExecutableName(token) {
  return stringOrEmpty(token).split(/[\\/]/).pop().toLowerCase();
}

function commandRemainder(tokens, index) {
  return tokens.slice(index).join(' ').trim();
}

function unwrapShellCommand(value) {
  const tokens = splitCommandLine(value);
  if (tokens.length < 2) {
    return '';
  }
  const executable = commandExecutableName(tokens[0]);
  if (executable === 'powershell.exe' || executable === 'powershell' || executable === 'pwsh.exe' || executable === 'pwsh') {
    const commandIndex = tokens.findIndex((token, index) => {
      const normalized = token.toLowerCase();
      return index > 0 && (normalized === '-command' || normalized === '-c');
    });
    return commandIndex >= 0 ? commandRemainder(tokens, commandIndex + 1) : '';
  }
  if (executable === 'cmd.exe' || executable === 'cmd') {
    const commandIndex = tokens.findIndex((token, index) => {
      const normalized = token.toLowerCase();
      return index > 0 && (normalized === '/c' || normalized === '-c');
    });
    return commandIndex >= 0 ? commandRemainder(tokens, commandIndex + 1) : '';
  }
  return '';
}

function commandSummary(params = {}) {
  const command = params.command;
  if (Array.isArray(command)) {
    const summary = command.map((part) => String(part)).join(' ').trim();
    return unwrapShellCommand(summary) || summary;
  }
  const summary = stringOrEmpty(command);
  return (summary ? unwrapShellCommand(summary) || summary : '') || stringOrEmpty(params.reason) || 'Command approval requested';
}

function fileSummary(params = {}) {
  return (
    stringOrEmpty(params.reason) ||
    stringOrEmpty(params.path) ||
    stringOrEmpty(params.filePath) ||
    stringOrEmpty(params.file) ||
    'File change approval requested'
  );
}

function permissionsSummary(params = {}) {
  const reason = stringOrEmpty(params.reason);
  if (reason) {
    return reason;
  }
  const permissions = params.permissions && typeof params.permissions === 'object' ? params.permissions : {};
  const keys = Object.keys(permissions);
  return keys.length ? `Permissions requested: ${keys.join(', ')}` : 'Permission approval requested';
}

export function desktopApprovalId(threadId, requestId) {
  return `${stringOrEmpty(threadId)}:${stringOrEmpty(requestId)}`;
}

export function normalizeDesktopApprovalRequest(snapshot = {}, { now = () => Date.now() } = {}) {
  const request = snapshot.request || {};
  const method = stringOrEmpty(request.method);
  const kind = SUPPORTED_METHODS.get(method);
  if (!kind) {
    return null;
  }

  const params = request.params && typeof request.params === 'object' ? request.params : {};
  const threadId = stringOrEmpty(snapshot.threadId || params.threadId || params.conversationId);
  const requestId = stringOrEmpty(snapshot.requestId || request.id);
  if (!threadId || !requestId) {
    return null;
  }

  const turnId = stringOrEmpty(params.turnId || params.itemId || requestId);
  const itemId = stringOrEmpty(params.itemId || requestId);
  const summary =
    kind === 'command'
      ? commandSummary(params)
      : kind === 'file'
        ? fileSummary(params)
        : permissionsSummary(params);
  const permissions = params.permissions && typeof params.permissions === 'object'
    ? clone(params.permissions)
    : {};
  const decisionSpecs = normalizeDecisionSpecs(params.availableDecisions);

  return {
    id: desktopApprovalId(threadId, requestId),
    requestId,
    threadId,
    turnId,
    itemId,
    kind,
    summary,
    cwd: stringOrEmpty(params.cwd) || null,
    reason: stringOrEmpty(params.reason) || null,
    source: 'desktop-ipc',
    actionable: true,
    availableDecisions: decisionSpecs.map((spec) => spec.key),
    decisionPayloads: Object.fromEntries(decisionSpecs.map((spec) => [spec.key, spec.payload])),
    permissions,
    createdAt: new Date(now()).toISOString(),
    request: clone(request)
  };
}

function publicApproval(approval) {
  if (!approval) {
    return null;
  }
  const { request, decisionPayloads, ...publicFields } = approval;
  return publicFields;
}

function payloadForDecisionKey(approval, key) {
  const decisionPayloads = approval.decisionPayloads && typeof approval.decisionPayloads === 'object'
    ? approval.decisionPayloads
    : {};
  if (Object.prototype.hasOwnProperty.call(decisionPayloads, key)) {
    return clone(decisionPayloads[key]);
  }
  return key;
}

function pickDecisionPayload(approval, candidates, fallback) {
  const available = Array.isArray(approval.availableDecisions) ? approval.availableDecisions : [];
  const selected = candidates.find((candidate) => available.includes(candidate)) || fallback;
  return payloadForDecisionKey(approval, selected);
}

function summarizeDecisionPayload(payload) {
  if (typeof payload === 'string') {
    return payload;
  }
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const keys = Object.keys(payload);
    return keys.length === 1 ? keys[0] : 'object';
  }
  return typeof payload;
}

export function mapDesktopApprovalDecision(approval, decision) {
  const normalizedDecision = stringOrEmpty(decision).toLowerCase();
  const approve = normalizedDecision === 'approve' || normalizedDecision === 'approved' || normalizedDecision === 'accept';
  const route = approval.kind;
  if (route === 'command' || route === 'file') {
    return {
      route,
      payload: approve
        ? pickDecisionPayload(approval, ['accept', 'acceptWithExecpolicyAmendment', 'acceptForSession'], 'accept')
        : pickDecisionPayload(approval, ['decline', 'cancel'], 'decline')
    };
  }
  if (route === 'permissions') {
    const available = Array.isArray(approval.availableDecisions) ? approval.availableDecisions : [];
    if (available.length) {
      return {
        route,
        payload: approve
          ? pickDecisionPayload(approval, ['accept', 'turn', 'session', 'acceptWithExecpolicyAmendment'], 'accept')
          : pickDecisionPayload(approval, ['decline', 'cancel'], 'decline')
      };
    }
    return {
      route,
      payload: approve
        ? { permissions: clone(approval.permissions) || {}, scope: 'turn' }
        : { permissions: {}, scope: 'turn' }
    };
  }
  return { route, payload: approve ? 'accept' : 'decline' };
}

export function isStaleDesktopApprovalError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    error?.statusCode === 404 ||
    message.includes('no-client-found') ||
    message.includes('not found') ||
    message.includes('not-found') ||
    message.includes('stale') ||
    message.includes('no longer pending')
  );
}

function isTransientDesktopApprovalError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    error?.code === 'CODEXMOBILE_DESKTOP_IPC_TIMEOUT' ||
    error?.code === 'CODEXMOBILE_DESKTOP_IPC_UNAVAILABLE' ||
    error?.code === 'CODEXMOBILE_DESKTOP_IPC_CLOSED' ||
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('disconnected') ||
    message.includes('closed')
  );
}

export class DesktopApprovalService {
  constructor({
    client = null,
    createClient = () => new DesktopIpcClient({ clientType: 'codexmobile-approvals' }),
    broadcast = () => {},
    reconnectDelayMs = 2500,
    connectTimeoutMs = 3000,
    now = () => Date.now(),
    logger = console
  } = {}) {
    this.client = client;
    this.createClient = createClient;
    this.broadcast = broadcast;
    this.reconnectDelayMs = reconnectDelayMs;
    this.connectTimeoutMs = connectTimeoutMs;
    this.now = now;
    this.logger = logger;
    this.records = new Map();
    this.started = false;
    this.connected = false;
    this.reconnectTimer = null;
    this.boundUpsert = (snapshot) => this.handleRequestUpserted(snapshot);
    this.boundRemove = (snapshot) => this.handleRequestRemoved(snapshot);
    this.boundDisconnect = () => this.handleDisconnect();
  }

  start() {
    if (this.started) {
      return;
    }
    this.started = true;
    if (!this.client) {
      this.client = this.createClient();
    }
    this.attachClient(this.client);
    this.connectClient().catch((error) => {
      this.connected = false;
      this.scheduleReconnect(error);
    });
  }

  async stop() {
    this.started = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.client) {
      this.detachClient(this.client);
      this.client.close?.();
    }
    this.connected = false;
  }

  attachClient(client) {
    client.on?.('requestUpserted', this.boundUpsert);
    client.on?.('requestRemoved', this.boundRemove);
    client.on?.('disconnected', this.boundDisconnect);
  }

  detachClient(client) {
    client.off?.('requestUpserted', this.boundUpsert);
    client.off?.('requestRemoved', this.boundRemove);
    client.off?.('disconnected', this.boundDisconnect);
  }

  async connectClient() {
    if (!this.client?.connect) {
      return;
    }
    await this.client.connect({ timeoutMs: this.connectTimeoutMs });
    this.connected = true;
    for (const snapshot of this.client.listRequests?.() || []) {
      this.handleRequestUpserted(snapshot);
    }
  }

  handleDisconnect() {
    this.connected = false;
    if (this.started) {
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (!this.started || this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectClient().catch(() => this.scheduleReconnect());
    }, this.reconnectDelayMs);
    this.reconnectTimer.unref?.();
  }

  handleRequestUpserted(snapshot) {
    const approval = normalizeDesktopApprovalRequest(snapshot, { now: this.now });
    if (!approval) {
      return null;
    }
    this.records.set(approval.id, approval);
    this.broadcast({
      type: 'desktop-approval-request',
      ...publicApproval(approval)
    });
    return publicApproval(approval);
  }

  handleRequestRemoved(snapshot) {
    const id = desktopApprovalId(snapshot.threadId, snapshot.requestId);
    const approval = this.records.get(id);
    if (!approval) {
      return false;
    }
    this.records.delete(id);
    this.broadcast({
      type: 'desktop-approval-stale',
      ...publicApproval(approval),
      stale: true,
      detail: '已在桌面端处理或不再等待审批'
    });
    return true;
  }

  listPending() {
    return [...this.records.values()].map(publicApproval);
  }

  getDiagnostics() {
    return {
      connected: this.connected,
      pendingCount: this.records.size
    };
  }

  async decide(id, decision) {
    const approval = this.records.get(stringOrEmpty(id));
    if (!approval) {
      return { ok: false, reason: 'not-found' };
    }
    const mapped = mapDesktopApprovalDecision(approval, decision);
    const logContext = {
      method: approval.request?.method || approval.kind,
      threadId: approval.threadId,
      requestIdType: typeof approval.requestId,
      route: mapped.route,
      payloadKey: summarizeDecisionPayload(mapped.payload)
    };
    try {
      let result;
      if (mapped.route === 'command') {
        result = await this.client.sendCommandApprovalDecision(approval.threadId, approval.requestId, mapped.payload);
      } else if (mapped.route === 'file') {
        result = await this.client.sendFileApprovalDecision(approval.threadId, approval.requestId, mapped.payload);
      } else if (mapped.route === 'permissions') {
        result = await this.client.sendPermissionsApprovalDecision(approval.threadId, approval.requestId, mapped.payload);
      } else {
        throw new Error(`Unsupported desktop approval kind: ${approval.kind}`);
      }
      this.logger?.info?.('[desktop-approval] decision sent', JSON.stringify({
        ...logContext,
        resultType: 'success',
        resultKeys: result && typeof result === 'object' ? Object.keys(result).slice(0, 5) : []
      }));
    } catch (error) {
      this.logger?.warn?.('[desktop-approval] decision failed', JSON.stringify({
        ...logContext,
        resultType: 'error',
        statusCode: error?.statusCode || null,
        code: error?.code || null,
        error: error?.message || String(error)
      }));
      if (isStaleDesktopApprovalError(error)) {
        this.records.delete(approval.id);
        this.broadcast({
          type: 'desktop-approval-stale',
          ...publicApproval(approval),
          stale: true,
          detail: '已在桌面端处理或不再等待审批'
        });
        return { ok: false, reason: 'stale' };
      }
      if (isTransientDesktopApprovalError(error)) {
        return { ok: false, reason: 'transient', error: error.message || 'Desktop approval decision failed' };
      }
      return { ok: false, reason: 'failed', error: error.message || 'Desktop approval decision failed' };
    }

    this.records.delete(approval.id);
    this.broadcast({
      type: 'desktop-approval-resolved',
      ...publicApproval(approval),
      decision: stringOrEmpty(decision).toLowerCase() === 'deny' ? 'deny' : 'approve'
    });
    return { ok: true, approval: publicApproval(approval) };
  }
}

export function createDesktopApprovalService(options = {}) {
  return new DesktopApprovalService(options);
}
