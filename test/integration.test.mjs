import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { parseManifestJson } from '@openchamber/sdk/schemas';

const run = promisify(execFile);

test('manifest is accepted by the OpenChamber SDK', async () => {
  const json = await readFile(new URL('../package.json', import.meta.url), 'utf8');
  const result = parseManifestJson(json);
  assert.equal(result.ok, true, JSON.stringify(result));
  const section = JSON.parse(json).openchamber.contributes.statusSection;
  assert.equal(section.entry, 'panel/index.html');
  assert.equal(section.defaultExpanded, true);
});

test('companion installer preserves config and refuses unknown files', async () => {
  const home = await mkdtemp(join(tmpdir(), 'session-tasks-install-'));
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, 'config') };
  const script = fileURLToPath(new URL('../scripts/companion.mjs', import.meta.url));
  const target = join(env.XDG_CONFIG_HOME, 'opencode', 'plugins', 'openchamber-session-tasks');
  try {
    await run(process.execPath, [script, 'install'], { env });
    assert.deepEqual((await readdir(target)).sort(), ['index.js', 'package.json']);
    await writeFile(join(target, 'keep.txt'), 'user work');
    await assert.rejects(() => run(process.execPath, [script, 'remove'], { env }), /extra files/);
    assert.equal(await readFile(join(target, 'keep.txt'), 'utf8'), 'user work');
    await rm(join(target, 'keep.txt'));
    await run(process.execPath, [script, 'remove'], { env });
    assert.deepEqual(await readdir(join(env.XDG_CONFIG_HOME, 'opencode', 'plugins')), []);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('reporter binds to authentic session and service is authenticated/read-only', async () => {
  const home = await mkdtemp(join(tmpdir(), 'session-tasks-integration-'));
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config') };
  const companion = new URL('../companion/index.js', import.meta.url).href;
  let child;
  try {
    const code = `
      import assert from 'node:assert/strict';
      const { default: plugin } = await import(${JSON.stringify(companion)});
      const tools = new Map(); let hook;
      await plugin.setup({ tool: { transform: async (callback) => callback({ add: (tool) => tools.set(tool.name, tool) }) }, session: { hook: async (_name, callback) => { hook = callback; } } });
      const context = { sessionID: 'ses_authentic', signal: new AbortController().signal };
      assert.equal(JSON.parse((await tools.get('session_tasks_read').execute({}, context)).content).revision, 0);
      await tools.get('session_tasks_report').execute({ revision: 0, title: 'Integration', sessionId: 'ses_spoofed', tasks: [{ id: 't', text: 'Verified', status: 'completed' }] }, context);
      const result = JSON.parse((await tools.get('session_tasks_read').execute({}, context)).content);
      assert.equal(result.sessionId, 'ses_authentic');
      const event = { system: [] }; hook(event); assert.match(event.system[0].text, /session_tasks_report/);
    `;
    await run(process.execPath, ['--input-type=module', '-e', code], { env });
    const probe = createServer();
    probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
    const port = probe.address().port;
    const token = 'isolated-test-token';
    await new Promise((resolve) => probe.close(resolve));
    child = spawn(process.execPath, [fileURLToPath(new URL('../service/main.cjs', import.meta.url))], { env: { ...env, OPENCHAMBER_SERVICE_PORT: String(port), OPENCHAMBER_SERVICE_TOKEN: token }, stdio: ['ignore', 'ignore', 'pipe'] });
    let serviceError = '';
    child.stderr.on('data', (chunk) => { serviceError += chunk.toString(); });
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { const response = await fetch(`${base}/health`, { headers: { Authorization: `Bearer ${token}` } }); ready = response.ok; } catch {}
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(ready, true, serviceError);
    assert.equal((await fetch(`${base}/health`)).status, 401);
    const options = { headers: { Authorization: `Bearer ${token}` } };
    assert.equal((await fetch(`${base}/companion`)).status, 401);
    const initial = await (await fetch(`${base}/companion`, options)).json();
    assert.equal(initial.state, 'not_installed');
    assert.ok(initial.path.startsWith(home));
    const post = (body) => fetch(`${base}/companion/install`, { method: 'POST', headers: { ...options.headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post({})).status, 400);
    assert.equal((await post({ confirmed: true, path: '/unexpected' })).status, 400);
    assert.equal((await (await fetch(`${base}/companion`, options)).json()).state, 'not_installed');
    assert.equal((await post(null)).status, 400);
    assert.equal((await post({ confirmed: true })).status, 400);
    assert.equal((await post({ confirmed: true, path: initial.path })).status, 200);
    assert.equal((await (await fetch(`${base}/companion`, options)).json()).state, 'installed');
    assert.equal((await post({ confirmed: true, path: initial.path })).status, 200);
    await writeFile(join(initial.path, 'user-work.txt'), 'preserve me');
    assert.equal((await post({ confirmed: true, path: initial.path })).status, 409);
    assert.equal(await readFile(join(initial.path, 'user-work.txt'), 'utf8'), 'preserve me');
    const stored = await (await fetch(`${base}/tasks?sessionId=ses_authentic`, options)).json();
    assert.equal(stored.report.tasks[0].status, 'completed');
    assert.equal((await (await fetch(`${base}/tasks?sessionId=ses_spoofed`, options)).json()).report, null);
    assert.equal((await fetch(`${base}/tasks?sessionId=..%2Foutside`, options)).status, 400);
    assert.equal((await fetch(`${base}/tasks`, { ...options, method: 'POST' })).status, 405);
  } finally {
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
    await rm(home, { recursive: true, force: true });
  }
});
