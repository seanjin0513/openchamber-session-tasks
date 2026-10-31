export const statuses = ['pending', 'in_progress', 'completed', 'blocked', 'cancelled'] as const;
export type Status = typeof statuses[number];
export type Task = { id: string; text: string; status: Status; note?: string };
export type Report = { version: 1; sessionId: string; revision: number; title: string; tasks: Task[]; updatedAt: string };
export const MAX_BYTES = 60 * 1024;

export function sessionKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,96}$/.test(value)) throw new Error('Invalid session ID');
  return value;
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Expected nonempty text up to ${max} characters`);
  return value.trim();
}

export function parseInput(value: unknown): { revision: number; title: string; tasks: Task[] } {
  if (!value || typeof value !== 'object') throw new Error('Expected a task report');
  const input = value as Record<string, unknown>;
  if (!Number.isSafeInteger(input.revision) || (input.revision as number) < 0) throw new Error('Invalid revision');
  if (!Array.isArray(input.tasks) || input.tasks.length > 80) throw new Error('Expected at most 80 tasks');
  const ids = new Set<string>();
  const tasks = input.tasks.map((item: unknown): Task => {
    if (!item || typeof item !== 'object') throw new Error('Invalid task');
    const task = item as Record<string, unknown>;
    const id = sessionKey(task.id);
    if (ids.has(id)) throw new Error('Duplicate task ID');
    ids.add(id);
    if (!statuses.includes(task.status as Status)) throw new Error('Invalid task status');
    return { id, text: text(task.text, 240), status: task.status as Status, ...(task.note === undefined ? {} : { note: text(task.note, 300) }) };
  });
  return { revision: input.revision as number, title: text(input.title, 120), tasks };
}

export function parseReport(value: unknown, sessionId: string): Report {
  const data = value as Report;
  const input = parseInput(value);
  if (data.version !== 1 || data.sessionId !== sessionId || input.revision < 1 || typeof data.updatedAt !== 'string' || !Number.isFinite(Date.parse(data.updatedAt))) throw new Error('Invalid stored report');
  return { version: 1, sessionId, ...input, updatedAt: data.updatedAt };
}

export function progress(tasks: Task[]) {
  const total = tasks.filter((task) => task.status !== 'cancelled').length;
  const completed = tasks.filter((task) => task.status === 'completed').length;
  return { total, completed, percent: total ? Math.round(completed / total * 100) : 0 };
}
