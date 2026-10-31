import { connectHost } from '@openchamber/sdk';
import { applyHostReady } from '@openchamber/sdk/ui';
import { createElement, RefreshCw, Circle, CircleDot, CircleCheck, CircleX, Ban } from 'lucide';
import { parseReport, progress, type Report, type Status } from './model';

const host = connectHost();
const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const refresh = element<HTMLButtonElement>('refresh');
refresh.replaceChildren(createElement(RefreshCw));
const labels: Record<Status, string> = { pending: '待办', in_progress: '进行中', completed: '已完成', blocked: '已阻塞', cancelled: '已取消' };
const icons = { pending: Circle, in_progress: CircleDot, completed: CircleCheck, blocked: CircleX, cancelled: Ban };
let session: { id: string; title: string; busy: boolean } | null = null;
let report: Report | null = null;
let filter = 'all';
let generation = 0;
let activeRequest: number | null = null;
let connected = true;
let initialized = false;

function message(text: string, error = false) {
  element('message').textContent = text;
  element('message').hidden = !text;
  element('message').classList.toggle('error', error);
}

function render() {
  element('summary').hidden = !report;
  element('tasks').replaceChildren();
  element('updated').textContent = report ? `更新于 ${new Date(report.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : '';
  element('source').textContent = report ? 'Agent 上报' : '';
  if (!report) return;
  element('title').textContent = report.title;
  const stats = progress(report.tasks);
  element('count').textContent = `${stats.completed} / ${stats.total}`;
  element('bar').style.width = `${stats.percent}%`;
  element('progress').setAttribute('aria-valuenow', String(stats.percent));
  const shown = report.tasks.filter((task) => filter === 'all' || (filter === 'completed' ? task.status === 'completed' : !['completed', 'cancelled'].includes(task.status)));
  for (const task of shown) {
    const row = document.createElement('li');
    row.className = `task ${task.status}`;
    const icon = createElement(icons[task.status]);
    icon.setAttribute('aria-hidden', 'true');
    const content = document.createElement('div');
    const text = document.createElement('p');
    text.className = 'task-text';
    text.textContent = task.text;
    content.append(text);
    if (task.note) {
      const note = document.createElement('p');
      note.className = 'note';
      note.textContent = task.note;
      content.append(note);
    }
    const state = document.createElement('span');
    state.className = 'state';
    state.textContent = labels[task.status];
    row.append(icon, content, state);
    element('tasks').append(row);
  }
  message(shown.length ? '' : report.tasks.length ? '没有符合筛选的任务' : '任务清单为空');
}

async function load() {
  if (!session || !connected || activeRequest === generation || document.hidden) return;
  const current = generation;
  const id = session.id;
  activeRequest = current;
  refresh.disabled = true;
  try {
    const response = await host.serviceRequest({ method: 'GET', path: '/tasks', query: { sessionId: id } });
    if (current !== generation || !connected) return;
    if (response.status !== 200) throw new Error('Service unavailable');
    const data = JSON.parse(response.body) as { report: unknown };
    report = data.report === null ? null : parseReport(data.report, id);
    render();
    if (!report) message('当前会话尚未上报任务');
  } catch {
    if (current === generation && connected) message(report ? '刷新失败，当前显示上次上报' : '无法读取任务，请检查扩展服务权限和上报组件', true);
  } finally {
    if (activeRequest === current) { activeRequest = null; refresh.disabled = false; }
  }
}

host.onReady((context) => {
  applyHostReady(context, document.documentElement);
  connected = context.connection.connected;
});
host.onSession((next) => {
  const changed = !initialized || next?.id !== session?.id;
  initialized = true;
  session = next;
  element('session').textContent = next?.title ?? '未选择会话';
  element('activity').textContent = next ? next.busy ? 'Agent 运行中' : 'Agent 空闲' : '';
  if (!changed) return;
  generation++;
  report = null;
  filter = 'all';
  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-filter]'))) button.setAttribute('aria-pressed', String(button.dataset.filter === filter));
  refresh.disabled = false;
  render();
  message(next ? '正在读取任务…' : '未选择会话');
  void load();
});
host.onConnection((connection) => {
  connected = connection.connected;
  if (!connected) message('OpenCode 连接已断开，任务状态未更新', true);
  else void load();
});
refresh.addEventListener('click', () => void load());
for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-filter]'))) button.addEventListener('click', () => {
  filter = button.dataset.filter!;
  for (const item of Array.from(document.querySelectorAll('[data-filter]'))) item.setAttribute('aria-pressed', String(item === button));
  render();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) void load(); });
const timer = setInterval(() => void load(), 2000);
window.addEventListener('pagehide', () => { clearInterval(timer); host.dispose(); });
