export function normalizeDesktopBridge(bridge = null) {
  return {
    strict: bridge?.strict !== false,
    connected: Boolean(bridge?.connected),
    mode: bridge?.mode || 'unavailable',
    reason: bridge?.reason || null,
    capabilities: bridge?.capabilities && typeof bridge.capabilities === 'object'
      ? bridge.capabilities
      : {}
  };
}

export function desktopBridgeCanCreateThread(bridge = null) {
  const normalized = normalizeDesktopBridge(bridge);
  if (!normalized.connected) {
    return false;
  }
  if (normalized.mode === 'desktop-ipc' && normalized.capabilities.createThread !== true) {
    return false;
  }
  if (normalized.capabilities.createThread === false) {
    return false;
  }
  return true;
}

export function newConversationState({ desktopBridge = null } = {}) {
  const bridge = normalizeDesktopBridge(desktopBridge);
  if (!bridge.connected) {
    return {
      disabled: true,
      mode: 'unavailable',
      label: '桌面端 Codex 未连接',
      reason: bridge.reason || '打开 Codex Desktop，并在电脑端新建或打开线程后再从手机继续发送。'
    };
  }
  if (!desktopBridgeCanCreateThread(bridge)) {
    return {
      disabled: true,
      mode: 'create-unavailable',
      label: '请先在电脑端新建/打开线程',
      reason: bridge.capabilities.createThreadReason || '请先在电脑端新建或打开线程，然后从手机继续发送。'
    };
  }
  return {
    disabled: false,
    mode: 'available',
    label: '新对话',
    reason: ''
  };
}

export function composerSendState({
  running = false,
  hasInput = false,
  uploading = false,
  desktopBridge = null,
  steerable = true,
  hasSelectedSession,
  sessionIsDraft = false
} = {}) {
  const bridge = normalizeDesktopBridge(desktopBridge);
  if (!bridge.connected) {
    return {
      disabled: true,
      label: '桌面端 Codex 未连接',
      mode: 'unavailable',
      showMenu: false,
      canSteer: false,
      canQueue: false,
      canInterrupt: false
    };
  }
  if (hasSelectedSession === false && bridge.mode === 'desktop-ipc' && !sessionIsDraft) {
    return {
      disabled: true,
      label: '请先选择桌面线程',
      mode: 'no-active-thread',
      showMenu: false,
      canSteer: false,
      canQueue: false,
      canInterrupt: false
    };
  }
  if (sessionIsDraft && !desktopBridgeCanCreateThread(bridge)) {
    return {
      disabled: true,
      label: '请先在电脑端新建/打开线程',
      mode: 'create-unavailable',
      showMenu: false,
      canSteer: false,
      canQueue: false,
      canInterrupt: false
    };
  }
  if (uploading) {
    return {
      disabled: true,
      label: '正在上传',
      mode: 'uploading',
      showMenu: false,
      canSteer: false,
      canQueue: false,
      canInterrupt: false
    };
  }
  if (running && !hasInput) {
    return {
      disabled: false,
      label: '中止当前任务',
      mode: 'abort',
      showMenu: false,
      canSteer: false,
      canQueue: false,
      canInterrupt: true
    };
  }
  if (running && hasInput) {
    return {
      disabled: false,
      label: steerable ? '发送到当前任务' : '选择发送方式',
      mode: steerable ? 'steer' : 'queue',
      showMenu: true,
      canSteer: Boolean(steerable),
      canQueue: true,
      canInterrupt: true
    };
  }
  return {
    disabled: !hasInput,
    label: '发送消息',
    mode: 'start',
    showMenu: false,
    canSteer: false,
    canQueue: false,
    canInterrupt: false
  };
}

export function composerSubmitAction({
  stopMode = false,
  runningInputMode = false,
  hasInput = false,
  sendState = {}
} = {}) {
  if (stopMode) {
    return { type: 'abort' };
  }
  if (runningInputMode) {
    if (sendState.canSteer && sendState.mode === 'steer') {
      return { type: 'submit', mode: 'steer' };
    }
    return { type: 'menu' };
  }
  if (hasInput) {
    return { type: 'submit', mode: 'start' };
  }
  return { type: 'none' };
}
