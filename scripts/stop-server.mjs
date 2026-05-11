import fs from 'node:fs';
import path from 'node:path';
import {
  CODEXMOBILE_SERVICE_NAME,
  commandForPid,
  commandMatchesCodexMobileServer,
  listenerPidsForPort,
  pidFilePath,
  pidIsAlive,
  pidRecordIdentifiesListener
} from './codexmobile-service.mjs';

const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.PORT || 3321);
const serviceName = process.argv.slice(2).find((arg) => arg && !arg.startsWith('-')) || CODEXMOBILE_SERVICE_NAME;
const pidPath = pidFilePath(root);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readPidRecord() {
  if (!fs.existsSync(pidPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(pidPath, 'utf8'));
  } catch {
    return null;
  }
}

function removePidFile() {
  try {
    fs.rmSync(pidPath, { force: true });
  } catch {
    // Best effort cleanup only.
  }
}

function commandMatches(pid, { allowLegacy = true } = {}) {
  const command = commandForPid(pid);
  return commandMatchesCodexMobileServer(command, {
    root,
    serviceName,
    allowLegacy
  });
}

function candidatePids() {
  const candidates = new Map();
  const record = readPidRecord();
  const listenerPids = listenerPidsForPort(port);
  if (
    record &&
    pidRecordIdentifiesListener(record, {
      root,
      port,
      serviceName,
      listenerPids
    }) &&
    pidIsAlive(record.pid)
  ) {
    candidates.set(Number(record.pid), 'pid-file');
  }

  for (const pid of listenerPids) {
    if (commandMatches(pid, { allowLegacy: true })) {
      candidates.set(Number(pid), candidates.get(Number(pid)) || 'port-scan');
    }
  }
  return candidates;
}

async function stopPids(pids) {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Process already exited.
    }
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (pids.every((pid) => !pidIsAlive(pid))) {
      return false;
    }
    await sleep(100);
  }

  let forceStopped = false;
  for (const pid of pids) {
    if (pidIsAlive(pid)) {
      process.kill(pid, 'SIGKILL');
      forceStopped = true;
    }
  }
  return forceStopped;
}

const candidates = candidatePids();
const pids = [...candidates.keys()];

if (!pids.length) {
  const record = readPidRecord();
  if (record && !pidIsAlive(record.pid)) {
    removePidFile();
  }
  console.log(`No running ${serviceName} CodexMobile server found on port ${port}.`);
  process.exit(0);
}

const forceStopped = await stopPids(pids);
removePidFile();
console.log(`${forceStopped ? 'Force-stopped' : 'Stopped'} ${serviceName} CodexMobile server on port ${port}: ${pids.join(', ')}`);
process.exit(0);
