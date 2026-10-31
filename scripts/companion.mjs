import { copyFile, mkdir, readFile, readdir, unlink, rmdir, lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const command = process.argv[2] ?? 'status';
const config = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
const target = join(config, 'opencode', 'plugins', 'openchamber-session-tasks');
const source = fileURLToPath(new URL('../companion/', import.meta.url));
const files = ['package.json', 'index.js'];

async function owned() {
  try {
    if (!(await lstat(target)).isDirectory()) throw new Error('Refusing a non-directory target');
    const manifest = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
    if (manifest.name !== 'openchamber-session-tasks-reporter') throw new Error('Refusing to change an unrecognized plugin');
    const entries = await readdir(target);
    if (entries.some((name) => !files.includes(name))) throw new Error('Plugin contains extra files; preserve them and remove manually');
    for (const file of files) if (!(await lstat(join(target, file))).isFile()) throw new Error('Refusing a non-regular plugin file');
    return true;
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

if (command === 'install') {
  const exists = await lstat(target).catch((error) => { if (error.code !== 'ENOENT') throw error; return null; });
  if (exists && !await owned()) throw new Error('Target already exists without ownership metadata');
  await mkdir(target, { recursive: true });
  for (const file of files) await copyFile(join(source, file), join(target, file));
  console.log(`Installed: ${target}\nOpenCode V2 watches plugins automatically. No opencode.json or AGENTS.md changes.`);
} else if (command === 'remove') {
  if (await owned()) {
    for (const file of files) await unlink(join(target, file));
    await rmdir(target);
  }
  console.log(`Reporter removed: ${target}\nTask reports preserved in ~/.local/share/openchamber-session-tasks`);
} else if (command === 'status') {
  console.log(`${await owned() ? 'Installed' : 'Not installed'}: ${target}`);
} else {
  throw new Error('Usage: node scripts/companion.mjs install|remove|status');
}
