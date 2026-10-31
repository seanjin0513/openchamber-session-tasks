import { build } from 'esbuild';

await build({ entryPoints: ['src/panel.ts'], outfile: 'panel/main.js', bundle: true, format: 'iife', platform: 'browser', target: 'chrome120' });
await build({ entryPoints: ['src/service.ts'], outfile: 'service/main.cjs', bundle: true, format: 'cjs', platform: 'node', target: 'node22' });
await build({ entryPoints: ['src/reporter.ts'], outfile: 'companion/index.js', bundle: true, format: 'esm', platform: 'node', target: 'node22' });
await build({ entryPoints: ['src/store.ts'], outfile: 'test/store.js', bundle: true, format: 'esm', platform: 'node', target: 'node22' });
await build({ entryPoints: ['src/installer.ts'], outfile: 'scripts/installer.js', bundle: true, format: 'esm', platform: 'node', target: 'node22' });
