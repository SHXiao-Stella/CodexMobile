import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { applyMacSystemProxyEnv } from './system-proxy-env.mjs';
import {
  CODEXMOBILE_SERVICE_ARG,
  CODEXMOBILE_SERVICE_NAME,
  commandForPid,
  commandMatchesCodexMobileServer,
  listenerPidsForPort,
  pidFilePath,
  pidIsAlive,
  serviceChildPath
} from './codexmobile-service.mjs';

const root = path.resolve(import.meta.dirname, '..');
const logDir = path.join(root, '.codexmobile');
const port = Number(process.env.PORT || 3321);
const launchdLabel = 'com.codexmobile.bridge';
const pidPath = pidFilePath(root);
fs.mkdirSync(logDir, { recursive: true });

const outPath = path.join(logDir, 'server.out.log');
const errPath = path.join(logDir, 'server.err.log');

function loadDotEnv() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) {
      continue;
    }
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function childEnv() {
  if (process.platform !== 'win32') {
    return process.env;
  }

  const env = {};
  const seen = new Set();
  for (const [key, value] of Object.entries(process.env)) {
    const normalized = key.toLowerCase();
    if (normalized === 'path' || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    env[key] = value;
  }

  env.Path = serviceChildPath([
    process.env.Path,
    process.env.PATH
  ].filter(Boolean).join(path.delimiter));
  const bundledCodex = path.join(path.dirname(process.execPath), process.platform === 'win32' ? 'codex.exe' : 'codex');
  if (!env.CODEXMOBILE_CODEX_BINARY && fs.existsSync(bundledCodex)) {
    env.CODEXMOBILE_CODEX_BINARY = bundledCodex;
  }
  return env;
}

loadDotEnv();
const proxyEnv = applyMacSystemProxyEnv();
if (proxyEnv.applied) {
  console.log(`Using macOS system proxy for background Codex requests: ${proxyEnv.proxyUrl}`);
}

function launchdDomain() {
  const uid = process.getuid?.();
  return Number.isInteger(uid) ? `gui/${uid}` : 'gui';
}

function restartLaunchAgentIfInstalled() {
  if (process.platform !== 'darwin') {
    return false;
  }
  const domain = launchdDomain();
  const serviceName = `${domain}/${launchdLabel}`;
  const printResult = spawnSync('launchctl', ['print', serviceName], {
    encoding: 'utf8'
  });
  if (printResult.status !== 0) {
    return false;
  }
  const output = `${printResult.stdout || ''}\n${printResult.stderr || ''}`;
  if (!output.includes(root) || !output.includes('scripts/run-server.mjs')) {
    return false;
  }
  const result = spawnSync('launchctl', ['kickstart', '-k', serviceName], {
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`launchctl kickstart failed${detail ? `:\n${detail}` : ''}`);
  }
  console.log(`CodexMobile is managed by launchd; restarted ${launchdLabel}.`);
  console.log(`Logs: ${path.join(logDir, 'launchd.out.log')}`);
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopExistingServer() {
  const pids = listenerPidsForPort(port).filter((pid) => {
    const command = commandForPid(pid);
    return commandMatchesCodexMobileServer(command, { root, allowLegacy: true });
  });
  if (!pids.length) {
    return;
  }
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Process already exited.
    }
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (pids.every((pid) => !pidIsAlive(pid))) {
      console.log(`Stopped existing CodexMobile server on port ${port}: ${pids.join(', ')}`);
      return;
    }
    await sleep(100);
  }
  for (const pid of pids) {
    if (pidIsAlive(pid)) {
      process.kill(pid, 'SIGKILL');
    }
  }
  console.log(`Force-stopped existing CodexMobile server on port ${port}: ${pids.join(', ')}`);
}

if (restartLaunchAgentIfInstalled()) {
  process.exit(0);
}

await stopExistingServer();

const out = fs.openSync(outPath, 'a');
const err = fs.openSync(errPath, 'a');
try {
  const child = spawn(process.execPath, ['server/index.js', CODEXMOBILE_SERVICE_ARG], {
    cwd: root,
    detached: true,
    stdio: ['ignore', out, err],
    windowsHide: true,
    env: childEnv()
  });

  child.unref();
  fs.writeFileSync(pidPath, `${JSON.stringify({
    pid: child.pid,
    serviceName: CODEXMOBILE_SERVICE_NAME,
    root,
    port,
    startedAt: new Date().toISOString()
  }, null, 2)}\n`);
  console.log(`CodexMobile server started in background, pid=${child.pid}`);
  console.log(`Service: ${CODEXMOBILE_SERVICE_NAME}`);
  console.log(`Logs: ${outPath}`);
} finally {
  fs.closeSync(out);
  fs.closeSync(err);
}
process.exit(0);
