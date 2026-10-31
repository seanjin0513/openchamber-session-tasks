"use strict";

// src/service.ts
var import_node_http = require("node:http");
var import_node_path3 = require("node:path");

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

// src/installer.ts
var import_promises2 = require("node:fs/promises");
var import_node_os2 = require("node:os");
var import_node_path2 = require("node:path");
var files = ["package.json", "index.js"];
var configRoot = process.env.XDG_CONFIG_HOME || (0, import_node_path2.join)((0, import_node_os2.homedir)(), ".config");
var companionPath = (0, import_node_path2.join)(configRoot, "opencode", "plugins", "openchamber-session-tasks");
async function owned(target) {
  try {
    if (!(await (0, import_promises2.lstat)(target)).isDirectory()) return "conflict";
  } catch (error) {
    if (error.code === "ENOENT") return "missing";
    throw error;
  }
  try {
    const entries = await (0, import_promises2.readdir)(target);
    if (entries.length !== files.length || entries.some((entry) => !files.includes(entry))) return "conflict";
    for (const file of files) if (!(await (0, import_promises2.lstat)((0, import_node_path2.join)(target, file))).isFile()) return "conflict";
    const manifest = JSON.parse(await (0, import_promises2.readFile)((0, import_node_path2.join)(target, "package.json"), "utf8"));
    return manifest?.name === "openchamber-session-tasks-reporter" ? "owned" : "conflict";
  } catch {
    return "conflict";
  }
}
async function inspectCompanion(source, target = companionPath) {
  const state = await owned(target);
  if (state === "missing") return { state: "not_installed", path: target };
  if (state === "conflict") return { state: "conflict", path: target };
  for (const file of files) {
    if (!(await (0, import_promises2.readFile)((0, import_node_path2.join)(source, file))).equals(await (0, import_promises2.readFile)((0, import_node_path2.join)(target, file)))) return { state: "update_available", path: target };
  }
  return { state: "installed", path: target };
}
async function removeFiles(directory) {
  for (const file of files) await (0, import_promises2.unlink)((0, import_node_path2.join)(directory, file));
  await (0, import_promises2.rmdir)(directory);
}
async function installCompanion(source, target = companionPath) {
  await (0, import_promises2.mkdir)((0, import_node_path2.dirname)(target), { recursive: true, mode: 448 });
  const lockPath = (0, import_node_path2.join)((0, import_node_path2.dirname)((0, import_node_path2.dirname)(target)), ".session-tasks-install.lock");
  const lock = await (0, import_promises2.open)(lockPath, "wx", 384);
  let staging;
  let previous;
  let committed = false;
  try {
    const status = await inspectCompanion(source, target);
    if (status.state === "conflict") throw new Error("COMPANION_CONFLICT: Target contains extra files or an unrecognized plugin");
    if (status.state === "installed") return status;
    staging = await (0, import_promises2.mkdtemp)((0, import_node_path2.join)((0, import_node_path2.dirname)((0, import_node_path2.dirname)(target)), ".session-tasks-install-"));
    const next = (0, import_node_path2.join)(staging, "next");
    await (0, import_promises2.mkdir)(next, { mode: 448 });
    for (const file of files) await (0, import_promises2.writeFile)((0, import_node_path2.join)(next, file), await (0, import_promises2.readFile)((0, import_node_path2.join)(source, file)), { mode: 384, flag: "wx" });
    if (await owned(next) !== "owned") throw new Error("Invalid bundled reporter");
    if (status.state === "update_available") {
      previous = (0, import_node_path2.join)(staging, "previous");
      await (0, import_promises2.rename)(target, previous);
    }
    try {
      await (0, import_promises2.rename)(next, target);
    } catch (error) {
      if (previous) {
        try {
          await (0, import_promises2.rename)(previous, target);
          previous = void 0;
        } catch {
          throw new Error(`Installation failed; previous reporter preserved at ${previous}`);
        }
      }
      throw error;
    }
    committed = true;
    return { state: "installed", path: target };
  } finally {
    try {
      if (staging) {
        const next = (0, import_node_path2.join)(staging, "next");
        for (const file of files) await (0, import_promises2.unlink)((0, import_node_path2.join)(next, file)).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
        await (0, import_promises2.rmdir)(next).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
        if (previous && committed) {
          await removeFiles(previous);
          previous = void 0;
        }
        if (!previous) await (0, import_promises2.rmdir)(staging);
      }
    } finally {
      await lock.close();
      await (0, import_promises2.unlink)(lockPath);
    }
  }
}

// src/service.ts
var port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
var token = process.env.OPENCHAMBER_SERVICE_TOKEN;
if (!Number.isInteger(port) || port < 1 || port > 65535 || !token) throw new Error("OpenChamber service environment is missing");
var companionSource = (0, import_node_path3.join)(__dirname, "..", "companion");
var server = (0, import_node_http.createServer)(async (request, response) => {
  const send = (status, body) => {
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify(body));
  };
  if (request.headers.authorization !== `Bearer ${token}`) return send(401, { error: "Unauthorized" });
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/health" && request.method === "GET") return send(200, { ok: true });
  if (url.pathname === "/companion") {
    if (request.method !== "GET") return send(405, { error: "Use POST /companion/install to install" });
    try {
      return send(200, await inspectCompanion(companionSource));
    } catch {
      return send(500, { error: "Reporter status could not be read" });
    }
  }
  if (url.pathname === "/companion/install") {
    if (request.method !== "POST") return send(405, { error: "Use POST to install" });
    let input;
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 4e3) return send(413, { error: "Request too large" });
        chunks.push(chunk);
      }
      input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return send(400, { error: "Invalid JSON" });
    }
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !["confirmed", "path"].includes(key)) || input.confirmed !== true || input.path !== companionPath) return send(400, { error: "Confirmation and exact install path are required" });
    try {
      const result = await installCompanion(companionSource);
      return send(200, result);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("COMPANION_CONFLICT")) return send(409, { error: "Target contains files not owned by this extension" });
      if (error.code === "EEXIST") return send(409, { error: "Installation already in progress" });
      return send(500, { error: "Reporter installation failed" });
    }
  }
  if (request.method !== "GET") return send(405, { error: "Method not allowed" });
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
