const frame = document.querySelector('iframe');
const scenario = document.querySelector('#scenario');
const theme = document.querySelector('#theme');
const envelope = { channel: 'openchamber.sdk', v: 1 };
const tasks = [
  { id: 'scope', text: '确认当前会话的数据来源', status: 'completed' },
  { id: 'panel', text: '实现任务面板与完成比例', status: 'completed' },
  { id: 'reporter', text: '验证上报工具和会话隔离', status: 'in_progress' },
  { id: 'integration', text: '安装后验证真实会话上报', status: 'blocked', note: '等待在 OpenChamber 中启用扩展' },
  { id: 'docs', text: '补全安装与卸载说明', status: 'pending' },
  { id: 'history', text: '增加跨会话历史看板', status: 'cancelled' },
];
function send(type, payload, extra = {}) { frame.contentWindow.postMessage({ ...envelope, type, payload, ...extra }, location.origin); }
function ready() {
  const dark = theme.value === 'dark';
  document.body.classList.toggle('dark', dark);
  send('ready', {
    directory: '/demo/project', session: scenario.value === 'none' ? null : { id: `demo_${scenario.value}`, title: scenario.value === 'empty' ? '新的会话' : '当前会话任务扩展', busy: scenario.value === 'sample' },
    locale: 'zh-CN', surface: 'panel', connection: { connected: scenario.value !== 'offline', account: '' }, settings: {}, item: null,
    theme: { mode: dark ? 'dark' : 'light', tokens: {
      background: dark ? '#232426' : '#fafafa', elevated: dark ? '#2b2c2e' : '#fff', foreground: dark ? '#ededed' : '#242424',
      muted: dark ? '#a5a5aa' : '#727272', subtle: '#888', border: dark ? '#3d3e40' : '#dedede', hover: dark ? '#343537' : '#ededed',
      selection: '#38665f', focus: '#288e7e', primary: '#288e7e', successText: dark ? '#6dce9a' : '#20805a', errorText: dark ? '#f1828b' : '#c74650',
      warningText: '#bf8d33', infoText: dark ? '#79b4ee' : '#2674bc', font: 'system-ui, sans-serif', mono: 'monospace', radius: '4px',
    } },
  });
}
window.addEventListener('message', ({ source, data }) => {
  if (source !== frame.contentWindow || data?.channel !== envelope.channel) return;
  if (data.type === 'hello') return ready();
  if (data.type !== 'service-request') return;
  const id = data.payload.query.sessionId;
  let report = null;
  if (id !== 'demo_empty') report = {
    version: 1, sessionId: id, revision: 1, title: '当前会话任务扩展', updatedAt: new Date().toISOString(),
    tasks: id === 'demo_long' ? [{ id: 'long', status: 'in_progress', text: '验证超长任务名称在窄面板内自动换行_LongUnbrokenTaskNameThatMustNeverOverflowOrOverlapStatusLabels', note: '检查移动端和侧栏宽度，确保状态标签与任务文本不会相互覆盖。' }] : tasks,
  };
  const status = id === 'demo_error' ? 500 : 200;
  // Delayed first-session answers exercise rapid session switching.
  setTimeout(() => send('result', { status, body: JSON.stringify({ report }) }, { id: data.id, ok: true }), id === 'demo_sample' ? 180 : 0);
});
scenario.addEventListener('change', ready);
theme.addEventListener('change', ready);
