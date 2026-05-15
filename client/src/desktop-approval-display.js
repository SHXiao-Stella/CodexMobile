function stringOrEmpty(value) {
  return String(value || '').trim();
}

export function desktopApprovalKindTitle(kind) {
  if (kind === 'file') {
    return '需要批准文件修改';
  }
  if (kind === 'permissions') {
    return '需要批准权限';
  }
  return '需要批准命令';
}

export function desktopApprovalView(approval = {}) {
  const display = approval.display && typeof approval.display === 'object' ? approval.display : {};
  return {
    title: stringOrEmpty(display.title) || desktopApprovalKindTitle(approval.kind),
    primary: stringOrEmpty(display.primary) ||
      stringOrEmpty(approval.summary) ||
      stringOrEmpty(approval.reason) ||
      'Codex Desktop 正在等待审批',
    secondary: stringOrEmpty(display.secondary) || stringOrEmpty(approval.cwd)
  };
}

const ERROR_VIEWS = {
  desktop_approval_not_found: {
    title: '审批已失效',
    body: '审批请求已过期。',
    inline: '审批请求已过期。',
    removeApproval: true
  },
  desktop_approval_stale: {
    title: '桌面端已处理',
    body: '桌面端已处理这条审批。',
    inline: '桌面端已处理这条审批。',
    removeApproval: true
  },
  desktop_approval_transient: {
    title: '审批暂时失败',
    body: '桌面端连接中断或超时，请稍后重试。',
    inline: '桌面端连接中断或超时，请稍后重试。',
    removeApproval: false
  },
  desktop_approval_failed: {
    title: '审批发送失败',
    body: '审批发送失败，请在电脑端处理。',
    inline: '审批发送失败，请在电脑端处理。',
    removeApproval: false
  }
};

export function desktopApprovalErrorView(error = {}) {
  const code = error.code || (error.status === 404 ? 'desktop_approval_not_found' : 'desktop_approval_failed');
  const view = ERROR_VIEWS[code] || ERROR_VIEWS.desktop_approval_failed;
  return {
    code,
    ...view
  };
}
