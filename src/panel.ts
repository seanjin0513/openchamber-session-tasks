import { connectHost } from '@openchamber/sdk';
import { applyHostReady } from '@openchamber/sdk/ui';
import { createElement, RefreshCw, Download, Circle, CircleDot, CircleCheck, CircleX, Ban } from 'lucide';
import { parseReport, progress, type Report, type Status } from './model';

const host = connectHost();
const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const refresh = element<HTMLButtonElement>('refresh');
refresh.replaceChildren(createElement(RefreshCw));
const install = element<HTMLButtonElement>('install');
const confirmInstall = element<HTMLButtonElement>('confirm-install');
const cancelInstall = element<HTMLButtonElement>('cancel-install');
install.prepend(createElement(Download));
const labels: Record<Status, string> = { pending: '待办', in_progress: '进行中', completed: '已完成', blocked: '已阻塞', cancelled: '已取消' };
const icons = { pending: Circle, in_progress: CircleDot, completed: CircleCheck, blocked: CircleX, cancelled: Ban };
let session: { id: string; title: string; busy: boolean } | null = null;
let report: Report | null = null;
let filter = 'all';
let generation = 0;
let activeRequest: number | null = null;
let initialized = false;
type CompanionStatus = { state: 'not_installed' | 'installed' | 'update_available' | 'conflict'; path: string };
let companion: CompanionStatus | null = null;
let checkingCompanion = false;
let installing = false;
let statusSurface = false;
let lastHeight = 0;
const main = document.querySelector('main')!;
const resizeObserver = new ResizeObserver(() => {
  if (!statusSurface) return;
  const height = Math.max(24, Math.min(320, Math.ceil(main.getBoundingClientRect().height)));
  if (height === lastHeight) return;
  lastHeight = height;
  void host.setHeight(height).catch(() => { lastHeight = 0; });
});
resizeObserver.observe(main);

function message(text: string, error = false) {
  element('message').textContent = text;
  element('message').hidden = !text;
  element('message').classList.toggle('error', error);
}

function setupMessage(text: string, error = false) {
  element('companion-state').textContent = text;
  element('companion-state').classList.toggle('error', error);
}

async function companionStatus() {
  if (checkingCompanion || installing) return;
  checkingCompanion = true;
  install.disabled = true;
  element('install-confirm').hidden = true;
  try {
    const response = await host.serviceRequest({ method: 'GET', path: '/companion' });
    if (response.status !== 200) throw new Error('Status unavailable');
    const status = JSON.parse(response.body) as CompanionStatus;
    if (!status || typeof status.path !== 'string' || !['not_installed', 'installed', 'update_available', 'conflict'].includes(status.state)) throw new Error('Invalid status');
    companion = status;
    install.hidden = !['not_installed', 'update_available'].includes(status.state);
    install.disabled = false;
    element('install-label').textContent = status.state === 'update_available' ? '更新上报组件' : '安装上报组件';
    element('install-path').textContent = status.path;
    const labels = { not_installed: '上报组件未安装', installed: '上报组件已安装', update_available: '上报组件可更新', conflict: '安装目录包含未知文件，已停止安装' };
    setupMessage(status.state === 'conflict' ? `${labels.conflict}：${status.path}` : labels[status.state], status.state === 'conflict');
  } catch {
    companion = null;
    install.hidden = true;
    setupMessage('无法检查上报组件，请确认本地服务已授权后刷新', true);
  } finally { checkingCompanion = false; }
}

async function installCompanion() {
  if (!companion || installing || element('install-confirm').hidden) return;
  const path = companion.path;
  installing = true;
  install.disabled = true;
  confirmInstall.disabled = true;
  cancelInstall.disabled = true;
  setupMessage('正在安装上报组件…');
  try {
    const response = await host.serviceRequest({ method: 'POST', path: '/companion/install', body: JSON.stringify({ confirmed: true, path }) });
    if (response.status === 409) throw new Error('安装冲突：请检查目标目录或稍后重试');
    if (response.status !== 200) throw new Error('安装失败，请确认目录写入权限后重试');
    companion = { state: 'installed', path };
    install.hidden = true;
    element('install-confirm').hidden = true;
    setupMessage('上报组件已安装');
    void load();
  } catch (error) {
    setupMessage(error instanceof Error ? error.message : '上报组件安装失败，请刷新后重试', true);
  } finally {
    installing = false;
    install.disabled = false;
    confirmInstall.disabled = false;
    cancelInstall.disabled = false;
  }
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
  if (!session || activeRequest === generation || document.hidden) return;
  const current = generation;
  const id = session.id;
  activeRequest = current;
  refresh.disabled = true;
  try {
    const response = await host.serviceRequest({ method: 'GET', path: '/tasks', query: { sessionId: id } });
    if (current !== generation) return;
    if (response.status !== 200) throw new Error('Service unavailable');
    const data = JSON.parse(response.body) as { report: unknown };
    report = data.report === null ? null : parseReport(data.report, id);
    render();
    if (!report) message('当前会话尚未上报任务');
  } catch {
    if (current === generation) message(report ? '刷新失败，当前显示上次上报' : '无法读取任务，请检查扩展本地服务是否已启用并授权', true);
  } finally {
    if (activeRequest === current) { activeRequest = null; refresh.disabled = false; }
  }
}

host.onReady((context) => {
  applyHostReady(context, document.documentElement);
  statusSurface = context.surface === 'status';
  void companionStatus();
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
refresh.addEventListener('click', () => { void load(); void companionStatus(); });
install.addEventListener('click', () => {
  if (!companion || installing || install.disabled || !['not_installed', 'update_available'].includes(companion.state)) return;
  confirmInstall.textContent = companion.state === 'update_available' ? '确认更新' : '确认安装';
  element('install-confirm').hidden = false;
  confirmInstall.focus();
});
confirmInstall.addEventListener('click', () => void installCompanion());
cancelInstall.addEventListener('click', () => { element('install-confirm').hidden = true; install.focus(); });
for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-filter]'))) button.addEventListener('click', () => {
  filter = button.dataset.filter!;
  for (const item of Array.from(document.querySelectorAll('[data-filter]'))) item.setAttribute('aria-pressed', String(item === button));
  render();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) void load(); });
const timer = setInterval(() => void load(), 2000);
window.addEventListener('pagehide', () => { clearInterval(timer); resizeObserver.disconnect(); host.dispose(); });
