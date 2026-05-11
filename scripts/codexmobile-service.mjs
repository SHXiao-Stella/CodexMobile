import { spawnSync } from 'node:child_process';
import path from 'node:path';

export const CODEXMOBILE_SERVICE_NAME = 'codexmobile';
export const CODEXMOBILE_SERVICE_ARG = `--codexmobile-service=${CODEXMOBILE_SERVICE_NAME}`;
export const CODEXMOBILE_PID_FILE = 'server.pid';

function normalizePathText(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .toLowerCase();
}

function normalizeRoot(root) {
  return normalizePathText(path.resolve(root || '.')).replace(/\/$/, '');
}

function hasServerEntry(command) {
  const normalized = normalizePathText(command);
  return normalized.includes('/server/index.js') ||
    normalized.includes('server/index.js') ||
    normalized.includes('/scripts/run-server.mjs') ||
    normalized.includes('scripts/run-server.mjs');
}

function hasServiceName(command, serviceName = CODEXMOBILE_SERVICE_NAME) {
  const normalized = String(command || '').toLowerCase();
  const name = String(serviceName || CODEXMOBILE_SERVICE_NAME).toLowerCase();
  return normalized.includes(`--codexmobile-service=${name}`);
}

function hasRoot(command, root) {
  const normalizedCommand = normalizePathText(command);
  const normalizedRoot = normalizeRoot(root);
  return normalizedRoot ? normalizedCommand.includes(normalizedRoot) : true;
}

export function commandMatchesCodexMobileServer(command, {
  root,
  serviceName = CODEXMOBILE_SERVICE_NAME,
  requireServiceName = false,
  allowLegacy = true
} = {}) {
  if (!command || !hasServerEntry(command) || !hasRoot(command, root)) {
    return false;
  }
  if (hasServiceName(command, serviceName)) {
    return true;
  }
  return !requireServiceName && allowLegacy;
}

export function pidFilePath(root) {
  return path.join(path.resolve(root || '.'), '.codexmobile', CODEXMOBILE_PID_FILE);
}

export function pidRecordMatchesService(record, {
  pid,
  root,
  port,
  serviceName = CODEXMOBILE_SERVICE_NAME
} = {}) {
  if (!record || Number(record.pid) !== Number(pid)) {
    return false;
  }
  if (String(record.serviceName || '').toLowerCase() !== String(serviceName).toLowerCase()) {
    return false;
  }
  if (Number(record.port) !== Number(port)) {
    return false;
  }
  return normalizeRoot(record.root) === normalizeRoot(root);
}

export function pidRecordIdentifiesListener(record, {
  root,
  port,
  listenerPids,
  serviceName = CODEXMOBILE_SERVICE_NAME
} = {}) {
  const pid = Number(record?.pid);
  return pidRecordMatchesService(record, {
    pid,
    root,
    port,
    serviceName
  }) && (listenerPids || []).map((item) => Number(item)).includes(pid);
}

export function dedupePath(value) {
  const seen = new Set();
  return String(value || '')
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      const key = process.platform === 'win32' ? item.toLowerCase() : item;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .join(path.delimiter);
}

export function serviceChildPath(currentPath, execPath = process.execPath) {
  const toolDir = path.dirname(execPath || '');
  return dedupePath([toolDir, currentPath].filter(Boolean).join(path.delimiter));
}

export function parsePids(output) {
  return String(output || '')
    .split(/\s+/)
    .map((item) => Number(item))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
}

export function listenerPidsForPort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0) {
    return [];
  }
  if (process.platform === 'win32') {
    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique`
    ], {
      encoding: 'utf8',
      windowsHide: true
    });
    return parsePids(result.stdout);
  }
  const result = spawnSync('lsof', [`-tiTCP:${port}`, '-sTCP:LISTEN'], {
    encoding: 'utf8'
  });
  if (result.status !== 0 && !result.stdout) {
    return [];
  }
  return parsePids(result.stdout);
}

export function commandForPid(pid) {
  const id = Number(pid);
  if (!Number.isInteger(id) || id <= 0) {
    return '';
  }
  if (process.platform === 'win32') {
    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${id}").CommandLine`
    ], {
      encoding: 'utf8',
      windowsHide: true
    });
    return result.status === 0 ? String(result.stdout || '').trim() : '';
  }
  const result = spawnSync('ps', ['-p', String(id), '-o', 'command='], {
    encoding: 'utf8'
  });
  return result.status === 0 ? String(result.stdout || '').trim() : '';
}

export function pidIsAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}
