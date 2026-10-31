import { fileURLToPath } from 'node:url';
import { companionPath, inspectCompanion, installCompanion, removeCompanion } from './installer.js';

const command = process.argv[2] ?? 'status';
const source = fileURLToPath(new URL('../companion/', import.meta.url));
if (command === 'install') {
  await installCompanion(source);
  console.log(`Installed: ${companionPath}\nOpenCode V2 watches plugins automatically. No opencode.json or AGENTS.md changes.`);
} else if (command === 'remove') {
  await removeCompanion();
  console.log(`Reporter removed: ${companionPath}\nTask reports preserved in ~/.local/share/openchamber-session-tasks`);
} else if (command === 'status') {
  const status = await inspectCompanion(source);
  console.log(`${status.state}: ${status.path}`);
} else {
  throw new Error('Usage: node scripts/companion.mjs install|remove|status');
}
