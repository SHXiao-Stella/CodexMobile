export function normalizePendingDesktopApproval(approval = {}) {
  const id = String(approval.id || '').trim();
  if (!id) {
    return null;
  }
  return {
    ...approval,
    id
  };
}

export function upsertPendingDesktopApproval(status = {}, approval = {}) {
  const normalized = normalizePendingDesktopApproval(approval);
  if (!normalized) {
    return status;
  }
  const current = Array.isArray(status.pendingApprovals) ? status.pendingApprovals : [];
  const next = [normalized, ...current.filter((item) => String(item?.id || '') !== normalized.id)];
  return {
    ...status,
    pendingApprovals: next
  };
}

export function removePendingDesktopApproval(status = {}, id = '') {
  const targetId = String(id || '').trim();
  if (!targetId) {
    return status;
  }
  const current = Array.isArray(status.pendingApprovals) ? status.pendingApprovals : [];
  return {
    ...status,
    pendingApprovals: current.filter((item) => String(item?.id || '') !== targetId)
  };
}
