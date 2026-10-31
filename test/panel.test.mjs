import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/panel.ts', import.meta.url))],
  bundle: true, write: false, format: 'iife', platform: 'browser',
  plugins: [{ name: 'panel-test-boundaries', setup(builder) {
    builder.onResolve({ filter: /^(@openchamber\/sdk(?:\/ui)?|lucide)$/ }, ({ path }) => ({ path, namespace: 'mock' }));
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({ contents:
      path === '@openchamber/sdk' ? 'export const connectHost = () => globalThis.testHost;' :
      path === '@openchamber/sdk/ui' ? 'export const applyHostReady = () => {};' :
      'export const createElement = () => document.createElement("svg"); export const RefreshCw=0, Circle=0, CircleDot=0, CircleCheck=0, CircleX=0, Ban=0;'
    }));
  } }],
});

function panel(serviceRequest) {
  const nodes = new Map();
  const node = () => ({
    textContent: '', hidden: false, disabled: false, style: {}, children: [], attributes: {},
    classList: { toggle() {} }, addEventListener() {},
    replaceChildren(...children) { this.children = children; },
    append(...children) { this.children.push(...children); },
    setAttribute(key, value) { this.attributes[key] = value; },
  });
  const get = (id) => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  const handlers = {};
  let poll;
  const testHost = {
    serviceRequest, dispose() {},
    onReady(callback) { handlers.ready = callback; },
    onSession(callback) { handlers.session = callback; },
    onConnection(callback) { handlers.connection = callback; },
  };
  runInNewContext(bundle.outputFiles[0].text, {
    testHost,
    document: { hidden: false, documentElement: node(), getElementById: get, querySelectorAll: () => [], createElement: node, addEventListener() {} },
    window: { addEventListener() {} },
    setInterval(callback) { poll = callback; return 1; }, clearInterval() {},
  });
  handlers.ready({ connection: { connected: false, account: '' } });
  return { get, handlers, poll: () => poll() };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
const session = (id) => ({ id, title: id, busy: false });
const response = (id) => ({ status: 200, body: JSON.stringify({ report: {
  version: 1, sessionId: id, revision: 1, title: id, updatedAt: new Date().toISOString(),
  tasks: [{ id: 'one', text: 'A reported task', status: 'in_progress' }],
} }) });

test('no integration account does not block task reads or polling', async () => {
  const calls = [];
  const ui = panel(async (request) => { calls.push(request); return response(request.query.sessionId); });
  ui.handlers.session(session('ses_local'));
  ui.handlers.connection?.({ connected: false, account: '' });
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(ui.get('tasks').children.length, 1);
  assert.equal(ui.get('message').textContent, '');
  ui.poll(); await tick();
  assert.equal(calls.length, 2);
});

test('no integration account still shows service failures and unreported sessions', async () => {
  let fail = true;
  const ui = panel(async () => {
    if (fail) throw new Error('Local service stopped');
    return { status: 200, body: '{"report":null}' };
  });
  ui.handlers.session(session('ses_local')); await tick();
  assert.match(ui.get('message').textContent, /无法读取任务/);
  fail = false;
  ui.poll(); await tick();
  assert.equal(ui.get('message').textContent, '当前会话尚未上报任务');
});

test('late reports cannot replace the newly selected session', async () => {
  const pending = new Map();
  const ui = panel((request) => new Promise((resolve) => pending.set(request.query.sessionId, resolve)));
  ui.handlers.session(session('ses_old'));
  ui.handlers.session(session('ses_new'));
  pending.get('ses_new')(response('ses_new')); await tick();
  pending.get('ses_old')(response('ses_old')); await tick();
  assert.equal(ui.get('title').textContent, 'ses_new');
  ui.handlers.session(null);
  assert.equal(ui.get('message').textContent, '未选择会话');
  assert.equal(ui.get('tasks').children.length, 0);
});
