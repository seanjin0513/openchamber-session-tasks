import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readReport, writeReport } from './store.js';

test('reports are revisioned and reject stale writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openchamber-session-tasks-'));
  try {
    const first = await writeReport('session_1', { revision: 0, title: 'Build', tasks: [{ id: 'one', text: 'Write code', status: 'in_progress' }] }, root);
    assert.equal(first.revision, 1);
    assert.equal((await readReport('session_1', root))?.tasks[0].status, 'in_progress');
    await assert.rejects(() => writeReport('session_1', { revision: 0, title: 'Stale', tasks: [] }, root), /Revision conflict/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('session isolation, validation, and private file modes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openchamber-session-tasks-'));
  const input = { revision: 0, title: 'Build', tasks: [{ id: 'one', text: '<script>alert(1)</script>', status: 'blocked' }] };
  try {
    await writeReport('session_a', input, root);
    assert.equal(await readReport('session_b', root), null);
    assert.equal((await readReport('session_a', root)).tasks[0].text, input.tasks[0].text);
    assert.equal((await stat(join(root, 'session_a.json'))).mode & 0o777, 0o600);
    await assert.rejects(() => readReport('../outside', root), /Invalid session/);
    await assert.rejects(() => writeReport('bad', { ...input, tasks: [input.tasks[0], input.tasks[0]] }, root), /Duplicate/);
    await assert.rejects(() => writeReport('bad', { ...input, tasks: [{ ...input.tasks[0], status: 'unknown' }] }, root), /Invalid task status/);
    await assert.rejects(() => writeReport('bad', { ...input, tasks: Array(81).fill(input.tasks[0]) }, root), /at most 80/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('corrupt and oversized files fail without overwriting previous data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openchamber-session-tasks-'));
  try {
    await writeFile(join(root, 'broken.json'), '{');
    await assert.rejects(() => readReport('broken', root));
    await assert.rejects(() => writeReport('broken', { revision: 0, title: 'Do not replace', tasks: [] }, root));
    await writeFile(join(root, 'large.json'), 'x'.repeat(64 * 1024));
    await assert.rejects(() => readReport('large', root), /Invalid task file/);
    await symlink(join(root, 'large.json'), join(root, 'link.json'));
    await assert.rejects(() => readReport('link', root));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('simultaneous writers cannot silently overwrite each other', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openchamber-session-tasks-'));
  try {
    const input = { revision: 0, title: 'Concurrent', tasks: [] };
    const results = await Promise.allSettled([writeReport('shared', input, root), writeReport('shared', input, root)]);
    assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
    assert.equal((await readReport('shared', root)).revision, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
