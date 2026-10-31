import type { Plugin } from '@opencode/plugin';
import { readReport, writeReport } from './store';
import { statuses } from './model';

const reporter: Plugin.Plugin = {
  id: 'openchamber-session-tasks',
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: 'session_tasks_read',
        description: 'Read the current session task checklist and revision. No report means revision 0.',
        input: { type: 'object', properties: {}, additionalProperties: false },
        execute: async (_input, context) => ({ content: JSON.stringify(await readReport(context.sessionID) ?? { revision: 0, tasks: [] }) }),
      });
      editor.add({
        name: 'session_tasks_report',
        description: 'Replace the CURRENT session task checklist with a full snapshot. Use stable task IDs, include unchanged tasks, and supply the last read/returned revision (0 for the first report). Never mark unverified work completed.',
        input: {
          type: 'object', additionalProperties: false, required: ['revision', 'title', 'tasks'],
          properties: {
            revision: { type: 'integer', minimum: 0 },
            title: { type: 'string', minLength: 1, maxLength: 120 },
            tasks: {
              type: 'array', maxItems: 80,
              items: {
                type: 'object', additionalProperties: false, required: ['id', 'text', 'status'],
                properties: {
                  id: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,96}$' },
                  text: { type: 'string', minLength: 1, maxLength: 240 },
                  status: { type: 'string', enum: [...statuses] },
                  note: { type: 'string', minLength: 1, maxLength: 300 },
                },
              },
            },
          },
        },
        execute: async (input, context) => {
          context.signal.throwIfAborted();
          const report = await writeReport(context.sessionID, input);
          return { content: JSON.stringify({ revision: report.revision, updatedAt: report.updatedAt, count: report.tasks.length }) };
        },
      });
    });
    await ctx.session.hook('context', (event) => {
      event.system.push({ type: 'text', text: 'The user enabled a current-session task panel. For multi-step work, use session_tasks_read, then session_tasks_report to publish and maintain a concise full checklist. Report meaningful state changes, blockers, and final verified results. Keep unfinished work pending or blocked. Do not infer completion from an idle session. Skip task reporting for trivial replies. Respect any user request to stop reporting.' });
    });
  },
};
export default reporter;
