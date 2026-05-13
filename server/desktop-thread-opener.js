import { spawn } from 'node:child_process';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildCodexThreadUrl(conversationId) {
  const id = String(conversationId || '').trim();
  if (!UUID_RE.test(id)) {
    return null;
  }
  return `codex://threads/${id}`;
}

export async function openCodexDesktopThread(conversationId, {
  platform = process.platform,
  spawnImpl = spawn
} = {}) {
  const url = buildCodexThreadUrl(conversationId);
  if (!url) {
    return { opened: false, reason: 'invalid-conversation-id' };
  }

  let command = null;
  let args = null;
  if (platform === 'win32') {
    command = 'rundll32.exe';
    args = ['url.dll,FileProtocolHandler', url];
  } else if (platform === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let child = null;
    try {
      child = spawnImpl(command, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
    } catch (error) {
      finish({ opened: false, reason: error?.message || String(error) });
      return;
    }

    if (!child || typeof child.once !== 'function') {
      finish({ opened: true, url });
      return;
    }

    child.once('error', (error) => {
      finish({ opened: false, reason: error?.message || String(error) });
    });
    child.once('spawn', () => {
      child.unref?.();
      finish({ opened: true, url });
    });
  });
}
