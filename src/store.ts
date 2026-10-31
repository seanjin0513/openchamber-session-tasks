import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { MAX_BYTES, parseInput, parseReport, sessionKey, type Report } from './model';

export const storeRoot = join(homedir(), '.local', 'share', 'openchamber-session-tasks');

export async function readReport(sessionId: string, root = storeRoot): Promise<Report | null> {
  const file = join(root, `${sessionKey(sessionId)}.json`);
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_BYTES) throw new Error('Invalid task file');
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > MAX_BYTES) throw new Error('Task report is too large');
    return parseReport(JSON.parse(bytes.subarray(0, bytesRead).toString('utf8')), sessionId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  } finally { await handle?.close(); }
}

export async function writeReport(sessionId: string, value: unknown, root = storeRoot): Promise<Report> {
  sessionKey(sessionId);
  const input = parseInput(value);
  await mkdir(root, { recursive: true, mode: 0o700 });
  // A filesystem lock also serializes separate plugin instances for this session.
  const lockPath = join(root, `${sessionId}.lock`);
  const lock = await open(lockPath, 'wx', 0o600);
  const temporary = join(root, `.${sessionId}-${randomUUID()}.tmp`);
  try {
    const current = await readReport(sessionId, root);
    if (input.revision !== (current?.revision ?? 0)) throw new Error(`Revision conflict: read current report first (revision ${current?.revision ?? 0})`);
    const report: Report = { version: 1, sessionId, ...input, revision: input.revision + 1, updatedAt: new Date().toISOString() };
    const body = JSON.stringify(report);
    if (Buffer.byteLength(body) > MAX_BYTES) throw new Error('Task report is too large');
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(body); } finally { await file.close(); }
    await rename(temporary, join(root, `${sessionId}.json`));
    return report;
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    await lock.close();
    await unlink(lockPath);
  }
}
