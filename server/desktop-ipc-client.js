import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fsSync from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const MAX_FRAME_BYTES = 256 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const DESKTOP_IPC_METHOD_VERSIONS = new Map([
  ['thread-stream-state-changed', 6],
  ['thread-read-state-changed', 1],
  ['thread-archived', 2],
  ['thread-unarchived', 1],
  ['thread-follower-start-turn', 1],
  ['thread-follower-compact-thread', 1],
  ['thread-follower-steer-turn', 1],
  ['thread-follower-interrupt-turn', 1],
  ['thread-follower-set-model-and-reasoning', 1],
  ['thread-follower-set-collaboration-mode', 1],
  ['thread-follower-edit-last-user-turn', 1],
  ['thread-follower-command-approval-decision', 1],
  ['thread-follower-file-approval-decision', 1],
  ['thread-follower-permissions-request-approval-response', 1],
  ['thread-follower-submit-user-input', 1],
  ['thread-follower-submit-mcp-server-elicitation-response', 1],
  ['thread-follower-set-queued-follow-ups-state', 1]
]);

export function desktopIpcMethodVersion(method) {
  return DESKTOP_IPC_METHOD_VERSIONS.get(method) || 0;
}

export function desktopIpcSocketPath() {
  if (process.platform === 'win32') {
    return String.raw`\\.\pipe\codex-ipc`;
  }
  const uid = process.getuid?.();
  return path.join(os.tmpdir(), 'codex-ipc', uid ? `ipc-${uid}.sock` : 'ipc.sock');
}

function frameFor(payload) {
  const json = JSON.stringify(payload);
  const size = Buffer.byteLength(json, 'utf8');
  const frame = Buffer.alloc(4 + size);
  frame.writeUInt32LE(size, 0);
  frame.write(json, 4, 'utf8');
  return frame;
}

function ipcError(message, code = 'CODEXMOBILE_DESKTOP_IPC_ERROR') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function coerceRequestId(value) {
  if (typeof value === 'number') {
    return value;
  }
  const normalized = String(value ?? '');
  return /^\d+$/.test(normalized) ? Number(normalized) : value;
}

function coerceParamsRequestId(params = {}) {
  if (!Object.prototype.hasOwnProperty.call(params, 'requestId')) {
    return params;
  }
  return {
    ...params,
    requestId: coerceRequestId(params.requestId)
  };
}

export function getDesktopIpcSocketStatus(sockPath = desktopIpcSocketPath()) {
  if (process.platform === 'win32') {
    return { ok: true, socketPath: sockPath, reason: null };
  }
  try {
    const stat = fsSync.statSync(sockPath);
    if (!stat.isSocket()) {
      return { ok: false, socketPath: sockPath, reason: `桌面端 IPC 路径不是 socket: ${sockPath}` };
    }
    return { ok: true, socketPath: sockPath, reason: null };
  } catch (error) {
    return {
      ok: false,
      socketPath: sockPath,
      reason: error.code === 'ENOENT'
        ? `桌面端 IPC socket 不存在: ${sockPath}`
        : `无法访问桌面端 IPC socket: ${error.message}`
    };
  }
}

export class DesktopIpcClient extends EventEmitter {
  constructor({ clientType = 'codexmobile', socketPath = desktopIpcSocketPath() } = {}) {
    super();
    this.clientType = clientType;
    this.socketPath = socketPath;
    this.clientId = 'initializing-client';
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.nextFrameSize = null;
    this.pending = new Map();
    this.conversationStatesByThread = new Map();
    this.ownerClientIdsByThread = new Map();
    this.requestsByThread = new Map();
  }

  isReady() {
    return Boolean(this.socket?.writable);
  }

  listRequests() {
    const snapshots = [];
    for (const [threadId, requests] of this.requestsByThread.entries()) {
      for (const [requestId, request] of requests.entries()) {
        snapshots.push({ threadId, requestId, request: structuredClone(request) });
      }
    }
    return snapshots.sort((left, right) => (
      left.threadId.localeCompare(right.threadId) ||
      left.requestId.localeCompare(right.requestId)
    ));
  }

  hasRequest(threadId, requestId) {
    return Boolean(this.requestsByThread.get(String(threadId || ''))?.has(String(requestId || '')));
  }

  getOwnerClientId(threadId) {
    const owner = this.ownerClientIdsByThread.get(String(threadId || ''));
    return typeof owner === 'string' && owner.trim() ? owner : null;
  }

  getConversationState(threadId) {
    const state = this.conversationStatesByThread.get(String(threadId || ''));
    return state ? structuredClone(state) : null;
  }

  clearDesktopState() {
    this.conversationStatesByThread.clear();
    this.ownerClientIdsByThread.clear();
    this.requestsByThread.clear();
  }

  async connect({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (this.socket?.writable) {
      return this;
    }
    const status = getDesktopIpcSocketStatus(this.socketPath);
    if (!status.ok) {
      throw ipcError(status.reason || '桌面端 Codex IPC 未连接', 'CODEXMOBILE_DESKTOP_IPC_UNAVAILABLE');
    }
    await new Promise((resolve, reject) => {
      const socket = net.createConnection(this.socketPath);
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(ipcError('连接桌面端 Codex IPC 超时', 'CODEXMOBILE_DESKTOP_IPC_TIMEOUT'));
      }, timeoutMs);
      socket.once('connect', () => {
        clearTimeout(timeout);
        this.socket = socket;
        socket.on('data', (chunk) => this.handleData(chunk));
        socket.on('close', () => this.handleDisconnect(ipcError('Codex Desktop IPC disconnected', 'CODEXMOBILE_DESKTOP_IPC_CLOSED')));
        socket.on('error', (error) => this.handleDisconnect(error));
        resolve();
      });
      socket.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    const initialized = await this.request('initialize', { clientType: this.clientType }, { timeoutMs });
    if (initialized?.resultType !== 'success' || initialized?.method !== 'initialize') {
      throw ipcError(initialized?.error || '桌面端 Codex IPC 初始化失败');
    }
    this.clientId = initialized.result?.clientId || this.clientId;
    return this;
  }

  async request(method, params = {}, { timeoutMs = DEFAULT_TIMEOUT_MS, targetClientId = null, version } = {}) {
    if (!this.socket?.writable) {
      throw ipcError('桌面端 Codex IPC 未连接', 'CODEXMOBILE_DESKTOP_IPC_UNAVAILABLE');
    }
    const requestId = crypto.randomUUID();
    const payload = {
      type: 'request',
      requestId,
      sourceClientId: this.clientId,
      version: version ?? desktopIpcMethodVersion(method),
      method,
      params
    };
    if (targetClientId) {
      payload.targetClientId = targetClientId;
    }
    const promise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(ipcError(`桌面端 Codex IPC 请求超时: ${method}`, 'CODEXMOBILE_DESKTOP_IPC_TIMEOUT'));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timeout });
    });
    this.socket.write(frameFor(payload));
    return promise;
  }

  sendBroadcast(method, params = {}, { version } = {}) {
    if (!this.socket?.writable) {
      throw ipcError('桌面端 Codex IPC 未连接', 'CODEXMOBILE_DESKTOP_IPC_UNAVAILABLE');
    }
    this.socket.write(frameFor({
      type: 'broadcast',
      method,
      sourceClientId: this.clientId,
      version: version ?? desktopIpcMethodVersion(method),
      params
    }));
  }

  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (this.nextFrameSize == null) {
        if (this.buffer.length < 4) {
          return;
        }
        this.nextFrameSize = this.buffer.readUInt32LE(0);
        this.buffer = this.buffer.subarray(4);
        if (this.nextFrameSize > MAX_FRAME_BYTES) {
          this.close();
          this.rejectAll(ipcError('桌面端 Codex IPC frame 过大'));
          return;
        }
      }
      if (this.buffer.length < this.nextFrameSize) {
        return;
      }
      const raw = this.buffer.subarray(0, this.nextFrameSize);
      this.buffer = this.buffer.subarray(this.nextFrameSize);
      this.nextFrameSize = null;
      let message;
      try {
        message = JSON.parse(raw.toString('utf8'));
      } catch {
        continue;
      }
      this.handleMessage(message);
    }
  }

  handleMessage(message) {
    if (message.type === 'client-discovery-request') {
      this.socket?.write(frameFor({
        type: 'client-discovery-response',
        requestId: message.requestId,
        response: { canHandle: false }
      }));
      return;
    }
    if (message.type === 'broadcast' && message.method === 'thread-stream-state-changed') {
      this.handleThreadStreamStateChanged(message);
      return;
    }
    if (message.type !== 'response') {
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (!pending) {
      return;
    }
    this.pending.delete(message.requestId);
    clearTimeout(pending.timeout);
    pending.resolve(message);
  }

  handleThreadStreamStateChanged(message) {
    const params = message?.params;
    if (!params || typeof params !== 'object') {
      return;
    }
    const threadId = typeof params.conversationId === 'string' && params.conversationId.trim()
      ? params.conversationId
      : null;
    const change = params.change;
    if (!threadId || !change || typeof change !== 'object') {
      return;
    }
    const nextConversationState = this.computeNextConversationState(threadId, change);
    if (!nextConversationState) {
      return;
    }

    const sourceClientId = typeof message.sourceClientId === 'string' && message.sourceClientId.trim()
      ? message.sourceClientId
      : null;
    if (sourceClientId) {
      this.ownerClientIdsByThread.set(threadId, sourceClientId);
    }

    const previous = this.requestsByThread.get(threadId) || new Map();
    const nextRequests = this.normalizeRequests(
      threadId,
      Array.isArray(nextConversationState.requests) ? nextConversationState.requests : []
    );
    const nextMap = new Map();
    for (const request of nextRequests) {
      nextMap.set(String(request.id), request);
    }

    for (const [requestId, request] of nextMap.entries()) {
      const previousRequest = previous.get(requestId);
      if (!previousRequest || JSON.stringify(previousRequest) !== JSON.stringify(request)) {
        this.emit('requestUpserted', { threadId, requestId, request: structuredClone(request) });
      }
    }

    for (const [requestId, request] of previous.entries()) {
      if (!nextMap.has(requestId)) {
        this.emit('requestRemoved', { threadId, requestId, request: request ? structuredClone(request) : null });
      }
    }

    if (nextMap.size) {
      this.requestsByThread.set(threadId, nextMap);
    } else {
      this.requestsByThread.delete(threadId);
    }
    this.conversationStatesByThread.set(threadId, nextConversationState);
    this.emit('conversationStateChanged', threadId, structuredClone(nextConversationState));
  }

  computeNextConversationState(threadId, change) {
    const changeType = typeof change.type === 'string' ? change.type : null;
    if (changeType === 'snapshot') {
      const state = change.conversationState;
      return state && typeof state === 'object' ? structuredClone(state) : null;
    }
    if (changeType !== 'patches') {
      return null;
    }
    const current = this.conversationStatesByThread.get(threadId);
    if (!current) {
      return null;
    }
    const patches = Array.isArray(change.patches) ? change.patches : [];
    if (!patches.length) {
      return null;
    }
    const root = structuredClone(current);
    for (const patch of patches) {
      this.applyPatch(root, patch);
    }
    return root;
  }

  applyPatch(root, patch) {
    if (!patch || typeof patch !== 'object') {
      return;
    }
    const op = typeof patch.op === 'string' ? patch.op : null;
    const patchPath = Array.isArray(patch.path) ? patch.path : null;
    if (!op || !patchPath || !patchPath.length) {
      return;
    }
    let parent = root;
    for (let index = 0; index < patchPath.length - 1; index += 1) {
      const segment = patchPath[index];
      if (parent == null || typeof parent !== 'object') {
        return;
      }
      if (Array.isArray(parent)) {
        if (typeof segment !== 'number' || segment < 0 || segment >= parent.length) {
          return;
        }
        parent = parent[segment];
        continue;
      }
      const key = String(segment);
      if (!(key in parent)) {
        parent[key] = typeof patchPath[index + 1] === 'number' ? [] : {};
      }
      parent = parent[key];
    }

    if (parent == null || typeof parent !== 'object') {
      return;
    }
    const last = patchPath[patchPath.length - 1];
    if (Array.isArray(parent)) {
      if (typeof last !== 'number') {
        return;
      }
      if (op === 'remove') {
        parent.splice(last, 1);
      } else if (op === 'add') {
        parent.splice(last, 0, structuredClone(patch.value));
      } else if (op === 'replace') {
        parent[last] = structuredClone(patch.value);
      }
      return;
    }

    const key = String(last);
    if (op === 'remove') {
      delete parent[key];
    } else if (op === 'add' || op === 'replace') {
      parent[key] = structuredClone(patch.value);
    }
  }

  normalizeRequests(threadId, rawRequests) {
    return rawRequests
      .map((raw) => this.normalizeRequest(threadId, raw))
      .filter(Boolean);
  }

  normalizeRequest(threadId, raw) {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const request = structuredClone(raw);
    const method = typeof request.method === 'string' ? request.method : null;
    const id = request.id;
    if (!method || (typeof id !== 'string' && typeof id !== 'number')) {
      return null;
    }
    const params = request.params && typeof request.params === 'object' ? { ...request.params } : {};
    if (typeof params.threadId !== 'string' || !params.threadId.trim()) {
      params.threadId = threadId;
    }
    if (typeof params.conversationId !== 'string' || !params.conversationId.trim()) {
      params.conversationId = threadId;
    }
    return {
      ...request,
      id,
      method,
      params
    };
  }

  async requestThreadFollower(method, params, options = {}) {
    const conversationId = String(params?.conversationId || '');
    const targetClientId = options.targetClientId || this.getOwnerClientId(conversationId) || null;
    const response = await this.request(method, coerceParamsRequestId(params), {
      ...options,
      ...(targetClientId ? { targetClientId } : {})
    });
    if (response.resultType === 'error') {
      const error = ipcError(response.error || `桌面端 Codex 拒绝请求: ${method}`);
      error.statusCode = response.error === 'no-client-found' ? 409 : 502;
      throw error;
    }
    return response.result;
  }

  sendCommandApprovalDecision(conversationId, requestId, decision, options = {}) {
    return this.requestThreadFollower('thread-follower-command-approval-decision', {
      conversationId,
      requestId: coerceRequestId(requestId),
      decision
    }, options);
  }

  sendFileApprovalDecision(conversationId, requestId, decision, options = {}) {
    return this.requestThreadFollower('thread-follower-file-approval-decision', {
      conversationId,
      requestId: coerceRequestId(requestId),
      decision
    }, options);
  }

  sendPermissionsApprovalDecision(conversationId, requestId, response, options = {}) {
    return this.requestThreadFollower('thread-follower-permissions-request-approval-response', {
      conversationId,
      requestId: coerceRequestId(requestId),
      response
    }, options);
  }

  submitUserInputResponse(conversationId, requestId, response, options = {}) {
    return this.requestThreadFollower('thread-follower-submit-user-input', {
      conversationId,
      requestId: coerceRequestId(requestId),
      response
    }, options);
  }

  rejectAll(error) {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  handleDisconnect(error) {
    if (!this.socket) {
      return;
    }
    this.socket = null;
    this.clearDesktopState();
    this.rejectAll(error || ipcError('Codex Desktop IPC disconnected', 'CODEXMOBILE_DESKTOP_IPC_CLOSED'));
    this.emit('disconnected', error || null);
  }

  close() {
    const socket = this.socket;
    this.socket = null;
    this.clearDesktopState();
    this.rejectAll(ipcError('Codex Desktop IPC closed', 'CODEXMOBILE_DESKTOP_IPC_CLOSED'));
    socket?.destroy();
  }
}

export async function probeDesktopIpc({ timeoutMs = 3000 } = {}) {
  const status = getDesktopIpcSocketStatus();
  if (!status.ok) {
    return { connected: false, mode: 'desktop-ipc', socketPath: status.socketPath, reason: status.reason };
  }
  const client = new DesktopIpcClient();
  try {
    await client.connect({ timeoutMs });
    return { connected: true, mode: 'desktop-ipc', socketPath: status.socketPath, reason: null };
  } catch (error) {
    return {
      connected: false,
      mode: 'desktop-ipc',
      socketPath: status.socketPath,
      reason: error.message || '桌面端 Codex IPC 连接失败'
    };
  } finally {
    client.close();
  }
}

async function requestDesktopFollower(method, params, options = {}) {
  const client = new DesktopIpcClient({
    ...(options.socketPath ? { socketPath: options.socketPath } : {})
  });
  try {
    await client.connect({ timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS });
    const { socketPath, ...requestOptions } = options;
    const response = await client.request(method, coerceParamsRequestId(params), requestOptions);
    if (response.resultType === 'error') {
      const error = ipcError(response.error || `桌面端 Codex 拒绝请求: ${method}`);
      error.statusCode = response.error === 'no-client-found' ? 409 : 502;
      throw error;
    }
    return response.result;
  } finally {
    client.close();
  }
}

export async function startDesktopFollowerTurn(conversationId, turnStartParams, options = {}) {
  return requestDesktopFollower('thread-follower-start-turn', {
    conversationId,
    turnStartParams
  }, options);
}

export async function steerDesktopFollowerTurn(conversationId, { input, attachments = [], restoreMessage = {} }, options = {}) {
  return requestDesktopFollower('thread-follower-steer-turn', {
    conversationId,
    input,
    attachments,
    restoreMessage
  }, options);
}

export async function interruptDesktopFollowerTurn(conversationId, options = {}) {
  return requestDesktopFollower('thread-follower-interrupt-turn', {
    conversationId
  }, options);
}

export async function setDesktopFollowerCollaborationMode(conversationId, collaborationMode, options = {}) {
  return requestDesktopFollower('thread-follower-set-collaboration-mode', {
    conversationId,
    collaborationMode
  }, options);
}

export async function setDesktopFollowerModelAndReasoning(conversationId, model, reasoningEffort, options = {}) {
  return requestDesktopFollower('thread-follower-set-model-and-reasoning', {
    conversationId,
    model,
    reasoningEffort
  }, options);
}

export async function submitDesktopFollowerUserInput(conversationId, request, options = {}) {
  return requestDesktopFollower('thread-follower-submit-user-input', {
    conversationId,
    ...request
  }, options);
}

export async function broadcastDesktopThreadArchived(conversationId, { hostId = 'local', cwd = null, timeoutMs = 1500 } = {}) {
  const client = new DesktopIpcClient({ clientType: 'codexmobile-archive-sync' });
  try {
    await client.connect({ timeoutMs });
    client.sendBroadcast('thread-archived', {
      hostId,
      conversationId,
      cwd
    });
    return { sent: true };
  } catch (error) {
    return {
      sent: false,
      reason: error.message || '桌面端 Codex IPC 广播失败'
    };
  } finally {
    client.close();
  }
}

export async function broadcastDesktopThreadTitleUpdated(
  conversationId,
  title,
  { hostId = 'local', socketPath = null, timeoutMs = 1500 } = {}
) {
  const client = new DesktopIpcClient({
    clientType: 'codexmobile-title-sync',
    ...(socketPath ? { socketPath } : {})
  });
  try {
    await client.connect({ timeoutMs });
    client.sendBroadcast('thread-title-updated', {
      hostId,
      conversationId,
      title
    });
    return { sent: true };
  } catch (error) {
    return {
      sent: false,
      reason: error.message || '桌面端 Codex IPC 广播失败'
    };
  } finally {
    client.close();
  }
}

export async function requestDesktopThreadSnapshotRefresh(
  conversationId,
  { socketPath = null, timeoutMs = 1500 } = {}
) {
  const client = new DesktopIpcClient({
    clientType: 'codexmobile-thread-refresh',
    ...(socketPath ? { socketPath } : {})
  });
  try {
    await client.connect({ timeoutMs });
    client.sendBroadcast('client-status-changed', {
      clientId: client.clientId,
      status: 'connected',
      conversationId
    });
    return { sent: true };
  } catch (error) {
    return {
      sent: false,
      reason: error.message || '妗岄潰绔?Codex IPC 骞挎挱澶辫触'
    };
  } finally {
    client.close();
  }
}
