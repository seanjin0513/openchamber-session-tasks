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
      'export const createElement = () => document.createElement("svg"); export const Download=0, RefreshCw=0, Circle=0, CircleDot=0, CircleCheck=0, CircleX=0, Ban=0;'
    }));
  } }],
});

function panel(serviceRequest, setupRequest = async () => setupResponse('installed'), surface = 'panel') {
  const nodes = new Map();
  const node = () => ({
    textContent: '', hidden: false, disabled: false, style: {}, children: [], attributes: {},
    classList: { toggle() {} }, events: {}, focus() {},
    addEventListener(name, handler) { this.events[name] = handler; },
    click() { if (!this.disabled && !this.hidden) this.events.click?.(); },
    replaceChildren(...children) { this.children = children; },
    prepend(...children) { this.children.unshift(...children); },
    append(...children) { this.children.push(...children); },
    setAttribute(key, value) { this.attributes[key] = value; },
  });
  const get = (id) => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  const handlers = {};
  let resize;
  let contentHeight = 100;
  const heights = [];
  let poll;
  const testHost = {
    setHeight: async (height) => { heights.push(height); },
    serviceRequest: (request) => request.path.startsWith('/companion') ? setupRequest(request) : serviceRequest(request), dispose() {},
    onReady(callback) { handlers.ready = callback; },
    onSession(callback) { handlers.session = callback; },
    onConnection(callback) { handlers.connection = callback; },
  };
  runInNewContext(bundle.outputFiles[0].text, {
    testHost,
    document: { hidden: false, documentElement: node(), getElementById: get, querySelector: () => ({ getBoundingClientRect: () => ({ height: contentHeight }) }), querySelectorAll: () => [], createElement: node, addEventListener() {} },
    ResizeObserver: class { constructor(callback) { resize = callback; } observe() {} disconnect() {} },
    window: { addEventListener() {} },
    setInterval(callback) { poll = callback; return 1; }, clearInterval() {},
  });
  handlers.ready({ surface, connection: { connected: false, account: '' } });
  return { get, handlers, poll: () => poll(), heights, resize(height) { contentHeight = height; resize(); } };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
const installPath = '/home/example/.config/opencode/plugins/openchamber-session-tasks';
const setupResponse = (state) => ({ status: 200, body: JSON.stringify({ state, path: installPath }) });
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

test('installation requires a separate confirmation click and works without a session', async () => {
  const calls = [];
  let resolveInstall;
  const ui = panel(async () => ({ status: 200, body: '{"report":null}' }), async (request) => {
    calls.push(request);
    if (request.method === 'POST') return new Promise((resolve) => { resolveInstall = resolve; });
    return setupResponse('not_installed');
  });
  await tick();
  assert.equal(ui.get('install').hidden, false);
  assert.equal(calls.length, 1);
  ui.get('install').click();
  assert.equal(ui.get('install-confirm').hidden, false);
  assert.equal(ui.get('install-path').textContent, installPath);
  assert.equal(calls.length, 1);
  ui.get('cancel-install').click();
  assert.equal(ui.get('install-confirm').hidden, true);
  ui.get('confirm-install').click();
  assert.equal(calls.length, 1);
  ui.get('install').click();
  ui.get('confirm-install').click();
  ui.get('confirm-install').click();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].body), { confirmed: true, path: installPath });
  assert.equal(ui.get('confirm-install').disabled, true);
  resolveInstall(setupResponse('installed')); await tick();
  assert.equal(ui.get('install').hidden, true);
  assert.equal(ui.get('install-confirm').hidden, true);
  assert.equal(ui.get('companion-state').textContent, '上报组件已安装');
});

test('update, conflict, permission failure and retry have explicit setup states', async () => {
  let state = 'update_available';
  let available = true;
  let failInstall = true;
  const ui = panel(async () => response('ses_local'), async (request) => {
    if (!available) throw new Error('Service disabled');
    if (request.method === 'POST') return failInstall ? { status: 500, body: '{}' } : setupResponse('installed');
    return setupResponse(state);
  });
  await tick();
  assert.equal(ui.get('install-label').textContent, '更新上报组件');
  ui.get('install').click(); ui.get('confirm-install').click(); await tick();
  assert.match(ui.get('companion-state').textContent, /安装失败/);
  assert.equal(ui.get('confirm-install').disabled, false);
  failInstall = false;
  ui.get('confirm-install').click(); await tick();
  assert.equal(ui.get('companion-state').textContent, '上报组件已安装');
  state = 'conflict';
  ui.get('refresh').click(); await tick();
  assert.equal(ui.get('install').hidden, true);
  assert.match(ui.get('companion-state').textContent, /未知文件/);
  available = false;
  ui.get('refresh').click(); await tick();
  assert.match(ui.get('companion-state').textContent, /授权/);
  available = true; state = 'not_installed';
  ui.get('refresh').click(); await tick();
  assert.equal(ui.get('install').hidden, false);
});

test('work status height follows content, caps at 320 and shrinks after collapse', () => {
  const ui = panel(async () => response('ses_local'), undefined, 'status');
  ui.resize(180.2);
  ui.resize(180.2);
  ui.resize(700);
  ui.resize(900);
  ui.resize(90);
  assert.deepEqual(ui.heights, [181, 320, 90]);
  const rail = panel(async () => response('ses_local'));
  rail.resize(200);
  assert.deepEqual(rail.heights, []);
});
