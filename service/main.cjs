"use strict";

// src/service.ts
var import_node_http = require("node:http");

// src/store.ts
var import_node_os = require("node:os");
var import_node_path = require("node:path");
var import_promises = require("node:fs/promises");
var import_node_fs = require("node:fs");

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
var storeRoot = (0, import_node_path.join)((0, import_node_os.homedir)(), ".local", "share", "openchamber-session-tasks");
async function readReport(sessionId, root = storeRoot) {
  const file = (0, import_node_path.join)(root, `${sessionKey(sessionId)}.json`);
  let handle;
  try {
    handle = await (0, import_promises.open)(file, import_node_fs.constants.O_RDONLY | (import_node_fs.constants.O_NOFOLLOW ?? 0));
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

// src/service.ts
var port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
var token = process.env.OPENCHAMBER_SERVICE_TOKEN;
if (!Number.isInteger(port) || port < 1 || port > 65535 || !token) throw new Error("OpenChamber service environment is missing");
var server = (0, import_node_http.createServer)(async (request, response) => {
  const send = (status, body) => {
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify(body));
  };
  if (request.headers.authorization !== `Bearer ${token}`) return send(401, { error: "Unauthorized" });
  if (request.method !== "GET") return send(405, { error: "Read-only service" });
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/health") return send(200, { ok: true });
  if (url.pathname !== "/tasks") return send(404, { error: "Not found" });
  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId || !/^[a-zA-Z0-9_-]{1,96}$/.test(sessionId)) return send(400, { error: "Invalid session ID" });
  try {
    return send(200, { report: await readReport(sessionId) });
  } catch {
    return send(500, { error: "Task report could not be read" });
  }
});
server.requestTimeout = 5e3;
server.listen(port, "127.0.0.1");
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
