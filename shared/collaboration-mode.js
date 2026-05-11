const VALID_REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);

export function normalizeComposerMode(mode) {
  return String(mode || '').trim().toLowerCase() === 'plan' ? 'plan' : 'chat';
}

function normalizeReasoningEffort(value) {
  const effort = String(value || '').trim();
  return VALID_REASONING_EFFORTS.has(effort) ? effort : null;
}

export function normalizeCollaborationMode(value, { model = '', reasoningEffort = '' } = {}) {
  const requestedMode = typeof value === 'string' ? value : value?.mode;
  const mode = String(requestedMode || '').trim().toLowerCase();
  if (mode !== 'plan') {
    return null;
  }
  const settings = typeof value === 'object' && value?.settings ? value.settings : {};
  return {
    mode: 'plan',
    settings: {
      model: String(settings.model || model || '').trim(),
      reasoning_effort: normalizeReasoningEffort(settings.reasoning_effort || settings.reasoningEffort || reasoningEffort),
      developer_instructions: settings.developer_instructions ?? null
    }
  };
}

export function collaborationModeForComposer({
  composerMode = 'chat',
  sendMode = 'start',
  model = '',
  reasoningEffort = ''
} = {}) {
  if (sendMode === 'steer') {
    return null;
  }
  if (normalizeComposerMode(composerMode) !== 'plan') {
    return null;
  }
  return normalizeCollaborationMode({
    mode: 'plan',
    settings: {
      model,
      reasoning_effort: reasoningEffort,
      developer_instructions: null
    }
  }, { model, reasoningEffort });
}
