import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectCompanion, installCompanion, removeCompanion } from '../scripts/installer.js';

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'companion-install-'));
  const source = join(root, 'bundle');
  const target = join(root, 'config', 'plugins', 'openchamber-session-tasks');
  await mkdir(source);
  await writeFile(join(source, 'package.json'), '{"name":"openchamber-session-tasks-reporter"}');
  await writeFile(join(source, 'index.js'), 'export default {}');
  try { await run({ root, source, target }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test('inspection never installs; install is idempotent and updates bundled files', () => fixture(async ({ source, target }) => {
  assert.equal((await inspectCompanion(source, target)).state, 'not_installed');
  assert.equal((await installCompanion(source, target)).state, 'installed');
  assert.equal((await stat(join(target, 'index.js'))).mode & 0o777, 0o600);
  await installCompanion(source, target);
  await writeFile(join(source, 'index.js'), 'export default { updated: true }');
  assert.equal((await inspectCompanion(source, target)).state, 'update_available');
  await installCompanion(source, target);
  assert.equal(await readFile(join(target, 'index.js'), 'utf8'), 'export default { updated: true }');
  assert.equal((await inspectCompanion(source, target)).state, 'installed');
  await removeCompanion(target);
  assert.equal((await inspectCompanion(source, target)).state, 'not_installed');
}));

test('unknown, partial and symlink targets are preserved', () => fixture(async ({ root, source, target }) => {
  await mkdir(target, { recursive: true });
  await writeFile(join(target, 'index.js'), 'user work');
  assert.equal((await inspectCompanion(source, target)).state, 'conflict');
  await assert.rejects(() => installCompanion(source, target), /CONFLICT/);
  assert.equal(await readFile(join(target, 'index.js'), 'utf8'), 'user work');
  await rm(target, { recursive: true });
  await symlink(source, target);
  await assert.rejects(() => installCompanion(source, target), /CONFLICT/);
  await rm(target);
  await installCompanion(source, target);
  await rm(join(target, 'index.js'));
  const outside = join(root, 'outside.js');
  await writeFile(outside, 'keep');
  await symlink(outside, join(target, 'index.js'));
  await assert.rejects(() => installCompanion(source, target), /CONFLICT/);
  await assert.rejects(() => removeCompanion(target), /Refusing/);
  assert.equal(await readFile(outside, 'utf8'), 'keep');
}));

test('invalid source and simultaneous installation cannot damage the prior package', () => fixture(async ({ source, target, root }) => {
  await installCompanion(source, target);
  await rm(join(source, 'index.js'));
  await assert.rejects(() => installCompanion(source, target));
  assert.equal(await readFile(join(target, 'index.js'), 'utf8'), 'export default {}');
  assert.deepEqual((await readdir(join(root, 'config'))).sort(), ['plugins']);
  await writeFile(join(source, 'index.js'), 'new version');
  const results = await Promise.allSettled([installCompanion(source, target), installCompanion(source, target)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(await readFile(join(target, 'index.js'), 'utf8'), 'new version');
}));
