// src/store.ts
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { constants } from "node:fs";

// src/model.ts
var statuses = ["pending", "in_progress", "completed", "blocked", "cancelled"];
var MAX_BYTES = 60 * 1024;
function sessionKey(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,96}$/.test(value)) throw new Error("Invalid session ID");
  return value;
}
function text(value, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`Expected nonempty text up to ${max} characters`);
  return value.trim();
}
function parseInput(value) {
  if (!value || typeof value !== "object") throw new Error("Expected a task report");
  const input = value;
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) throw new Error("Invalid revision");
  if (!Array.isArray(input.tasks) || input.tasks.length > 80) throw new Error("Expected at most 80 tasks");
  const ids = /* @__PURE__ */ new Set();
  const tasks = input.tasks.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Invalid task");
    const task = item;
    const id = sessionKey(task.id);
    if (ids.has(id)) throw new Error("Duplicate task ID");
    ids.add(id);
    if (!statuses.includes(task.status)) throw new Error("Invalid task status");
    return { id, text: text(task.text, 240), status: task.status, ...task.note === void 0 ? {} : { note: text(task.note, 300) } };
  });
  return { revision: input.revision, title: text(input.title, 120), tasks };
}
function parseReport(value, sessionId) {
  const data = value;
  const input = parseInput(value);
  if (data.version !== 1 || data.sessionId !== sessionId || input.revision < 1 || typeof data.updatedAt !== "string" || !Number.isFinite(Date.parse(data.updatedAt))) throw new Error("Invalid stored report");
  return { version: 1, sessionId, ...input, updatedAt: data.updatedAt };
}

// src/store.ts
var storeRoot = join(homedir(), ".local", "share", "openchamber-session-tasks");
async function readReport(sessionId, root = storeRoot) {
  const file = join(root, `${sessionKey(sessionId)}.json`);
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_BYTES) throw new Error("Invalid task file");
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > MAX_BYTES) throw new Error("Task report is too large");
    return parseReport(JSON.parse(bytes.subarray(0, bytesRead).toString("utf8")), sessionId);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  } finally {
    await handle?.close();
  }
}
async function writeReport(sessionId, value, root = storeRoot) {
  sessionKey(sessionId);
  const input = parseInput(value);
  await mkdir(root, { recursive: true, mode: 448 });
  const lockPath = join(root, `${sessionId}.lock`);
  const lock = await open(lockPath, "wx", 384);
  const temporary = join(root, `.${sessionId}-${randomUUID()}.tmp`);
  try {
    const current = await readReport(sessionId, root);
    if (input.revision !== (current?.revision ?? 0)) throw new Error(`Revision conflict: read current report first (revision ${current?.revision ?? 0})`);
    const report = { version: 1, sessionId, ...input, revision: input.revision + 1, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
    const body = JSON.stringify(report);
    if (Buffer.byteLength(body) > MAX_BYTES) throw new Error("Task report is too large");
    const file = await open(temporary, "wx", 384);
    try {
      await file.writeFile(body);
    } finally {
      await file.close();
    }
    await rename(temporary, join(root, `${sessionId}.json`));
    return report;
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    await lock.close();
    await unlink(lockPath);
  }
}

// src/reporter.ts
var reporter = {
  id: "openchamber-session-tasks",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "session_tasks_read",
        description: "Read the current session task checklist and revision. No report means revision 0.",
        input: { type: "object", properties: {}, additionalProperties: false },
        execute: async (_input, context) => ({ content: JSON.stringify(await readReport(context.sessionID) ?? { revision: 0, tasks: [] }) })
      });
      editor.add({
        name: "session_tasks_report",
        description: "Replace the CURRENT session task checklist with a full snapshot. Use stable task IDs, include unchanged tasks, and supply the last read/returned revision (0 for the first report). Never mark unverified work completed.",
        input: {
          type: "object",
          additionalProperties: false,
          required: ["revision", "title", "tasks"],
          properties: {
            revision: { type: "integer", minimum: 0 },
            title: { type: "string", minLength: 1, maxLength: 120 },
            tasks: {
              type: "array",
              maxItems: 80,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["id", "text", "status"],
                properties: {
                  id: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,96}$" },
                  text: { type: "string", minLength: 1, maxLength: 240 },
                  status: { type: "string", enum: [...statuses] },
                  note: { type: "string", minLength: 1, maxLength: 300 }
                }
              }
            }
          }
        },
        execute: async (input, context) => {
          context.signal.throwIfAborted();
          const report = await writeReport(context.sessionID, input);
          return { content: JSON.stringify({ revision: report.revision, updatedAt: report.updatedAt, count: report.tasks.length }) };
        }
      });
    });
    await ctx.session.hook("context", (event) => {
      event.system.push({ type: "text", text: "The user enabled a current-session task panel. For multi-step work, use session_tasks_read, then session_tasks_report to publish and maintain a concise full checklist. Report meaningful state changes, blockers, and final verified results. Keep unfinished work pending or blocked. Do not infer completion from an idle session. Skip task reporting for trivial replies. Respect any user request to stop reporting." });
    });
  }
};
var reporter_default = reporter;
export {
  reporter_default as default
};
