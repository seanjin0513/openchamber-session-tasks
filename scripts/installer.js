// src/installer.ts
import { mkdir, mkdtemp, readFile, readdir, lstat, unlink, writeFile, rename, rmdir, open } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
var files = ["package.json", "index.js"];
var configRoot = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
var companionPath = join(configRoot, "opencode", "plugins", "openchamber-session-tasks");
async function owned(target) {
  try {
    if (!(await lstat(target)).isDirectory()) return "conflict";
  } catch (error) {
    if (error.code === "ENOENT") return "missing";
    throw error;
  }
  try {
    const entries = await readdir(target);
    if (entries.length !== files.length || entries.some((entry) => !files.includes(entry))) return "conflict";
    for (const file of files) if (!(await lstat(join(target, file))).isFile()) return "conflict";
    const manifest = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
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
    if (!(await readFile(join(source, file))).equals(await readFile(join(target, file)))) return { state: "update_available", path: target };
  }
  return { state: "installed", path: target };
}
async function removeFiles(directory) {
  for (const file of files) await unlink(join(directory, file));
  await rmdir(directory);
}
async function installCompanion(source, target = companionPath) {
  await mkdir(dirname(target), { recursive: true, mode: 448 });
  const lockPath = join(dirname(dirname(target)), ".session-tasks-install.lock");
  const lock = await open(lockPath, "wx", 384);
  let staging;
  let previous;
  let committed = false;
  try {
    const status = await inspectCompanion(source, target);
    if (status.state === "conflict") throw new Error("COMPANION_CONFLICT: Target contains extra files or an unrecognized plugin");
    if (status.state === "installed") return status;
    staging = await mkdtemp(join(dirname(dirname(target)), ".session-tasks-install-"));
    const next = join(staging, "next");
    await mkdir(next, { mode: 448 });
    for (const file of files) await writeFile(join(next, file), await readFile(join(source, file)), { mode: 384, flag: "wx" });
    if (await owned(next) !== "owned") throw new Error("Invalid bundled reporter");
    if (status.state === "update_available") {
      previous = join(staging, "previous");
      await rename(target, previous);
    }
    try {
      await rename(next, target);
    } catch (error) {
      if (previous) {
        try {
          await rename(previous, target);
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
        const next = join(staging, "next");
        for (const file of files) await unlink(join(next, file)).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
        await rmdir(next).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
        if (previous && committed) {
          await removeFiles(previous);
          previous = void 0;
        }
        if (!previous) await rmdir(staging);
      }
    } finally {
      await lock.close();
      await unlink(lockPath);
    }
  }
}
async function removeCompanion(target = companionPath) {
  const state = await owned(target);
  if (state === "conflict") throw new Error("Refusing removal: plugin contains extra files or is unrecognized");
  if (state === "owned") await removeFiles(target);
}
export {
  companionPath,
  inspectCompanion,
  installCompanion,
  removeCompanion
};
