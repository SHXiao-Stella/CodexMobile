const CONNECTION_STATUS = {
  connected: { label: '已连接', className: 'is-connected', description: 'CodexMobile 服务已连接。' },
  connecting: { label: '连接中', className: 'is-connecting', description: '正在连接 CodexMobile 服务。' },
  disconnected: { label: '未连接', className: 'is-disconnected', description: 'CodexMobile 服务未连接。' }
};

function runtimeSource(runtime) {
  return String(runtime?.source || '').trim();
}

function isDesktopRuntime(runtime) {
  const source = runtimeSource(runtime);
  return source === 'desktop-ipc' || source === 'desktop-thread';
}

function isHeadlessRuntime(runtime) {
  const source = runtimeSource(runtime);
  return source === 'headless-local' || source === 'background' || source === 'local';
}

function hasDesktopThreadSelection(session) {
  const id = String(session?.id || '').trim();
  if (!id || id.startsWith('draft-')) {
    return false;
  }
  return !session?.draft;
}

export function bridgeConnectionLabel(connectionState, desktopBridge, { selectedSession = null, selectedRuntime = null } = {}) {
  if (connectionState !== 'connected') {
    return CONNECTION_STATUS[connectionState] || CONNECTION_STATUS.disconnected;
  }

  if (selectedRuntime?.status === 'running') {
    if (isDesktopRuntime(selectedRuntime)) {
      return {
        label: '桌面运行中',
        className: 'is-connected is-thread-ipc',
        description: '当前线程正在桌面端接管窗口里执行。'
      };
    }
    if (isHeadlessRuntime(selectedRuntime)) {
      return {
        label: '后台运行中',
        className: 'is-connected is-headless',
        description: '当前线程正在后台 Codex 执行，桌面端没有接管这个运行。'
      };
    }
    return {
      label: '运行确认中',
      className: 'is-connected is-route-pending',
      description: '当前线程正在运行，正在确认这次执行来自桌面接管还是后台 Codex。'
    };
  }

  if (desktopBridge && (!desktopBridge.connected || desktopBridge.mode === 'unavailable')) {
    return {
      label: '桌面未连接',
      className: 'is-connected is-disconnected',
      description: desktopBridge.reason || 'CodexMobile 服务在线，但没有连接到 Codex Desktop。'
    };
  }

  if (desktopBridge?.mode === 'headless-local') {
    return {
      label: '后台可用',
      className: 'is-connected is-headless',
      description: desktopBridge.reason || '桌面端不可用，发送会走后台 Codex。'
    };
  }

  if (desktopBridge?.mode === 'desktop-ipc') {
    const hasThread = hasDesktopThreadSelection(selectedSession);
    return {
      label: hasThread ? '已连接桌面当前线程' : '桌面已连接，但没有活动线程',
      className: 'is-connected is-ipc-ready',
      description: hasThread
        ? '手机消息会发送到 Codex Desktop 当前线程；如果桌面端未接管，会自动打开该线程并重试。'
        : '桌面 IPC 已连接。请先在电脑端新建或打开线程，然后从手机继续发送。'
    };
  }

  return CONNECTION_STATUS.connected;
}
