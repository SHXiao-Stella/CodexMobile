function stringOrEmpty(value) {
  return String(value || '').trim();
}

export function planImplementationRequestKey({ threadId, turnId, itemId } = {}) {
  return [threadId, turnId, itemId].map(stringOrEmpty).join(':');
}

export function normalizePlanImplementationRequest(message = {}) {
  const params = message.params || {};
  const threadId = stringOrEmpty(params.threadId || params.sessionId);
  const turnId = stringOrEmpty(params.turnId);
  const itemId = stringOrEmpty(params.itemId || message.id || (turnId ? `implement-plan:${turnId}` : ''));
  const planContent = stringOrEmpty(params.planContent || params.plan || params.content);
  if (!threadId || !turnId || !itemId || !planContent) {
    throw new Error('Malformed plan implementation request');
  }
  return {
    threadId,
    turnId,
    itemId,
    requestId: itemId,
    planContent,
    source: 'codex-app-server'
  };
}

export function normalizePlanImplementationDecision(value = {}) {
  const raw = stringOrEmpty(value.decision || value.action || value.response).toLowerCase();
  const decision = ['accept', 'approve', 'approved', 'implement', 'yes'].includes(raw)
    ? 'accept'
    : 'decline';
  return { decision };
}

export class PendingPlanImplementationRequests {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.records = new Map();
  }

  add(message, resolve) {
    const request = normalizePlanImplementationRequest(message);
    const key = planImplementationRequestKey(request);
    const record = {
      key,
      request,
      resolve,
      createdAt: this.now(),
      completed: false
    };
    this.records.set(key, record);
    return { key, request };
  }

  getDiagnostics() {
    const pendingByThread = {};
    for (const record of this.records.values()) {
      const threadId = record.request.threadId || 'unknown';
      pendingByThread[threadId] = (pendingByThread[threadId] || 0) + 1;
    }
    return {
      pendingCount: this.records.size,
      pendingByThread
    };
  }

  answer({ threadId, sessionId, turnId, itemId, requestId, decision }) {
    const key = planImplementationRequestKey({
      threadId: threadId || sessionId,
      turnId,
      itemId: itemId || requestId
    });
    const record = this.records.get(key);
    if (!record) {
      return { ok: false, reason: 'not-found' };
    }
    this.records.delete(key);
    record.completed = true;
    const response = normalizePlanImplementationDecision({ decision });
    record.resolve(response);
    return { ok: true, request: record.request, response };
  }

  clearForTurn({ threadId, turnId } = {}) {
    const cleared = [];
    for (const [key, record] of this.records.entries()) {
      if (
        (!threadId || record.request.threadId === threadId) &&
        (!turnId || record.request.turnId === turnId)
      ) {
        this.records.delete(key);
        record.resolve({ decision: 'decline' });
        cleared.push({
          ...record.request,
          key: record.key,
          createdAt: record.createdAt
        });
      }
    }
    return cleared;
  }
}
