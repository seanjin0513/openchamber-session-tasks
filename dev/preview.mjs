import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const routes = {
  '/': ['dev/index.html', 'text/html'],
  '/dev/bridge.js': ['dev/bridge.js', 'application/javascript'],
  '/panel/index.html': ['panel/index.html', 'text/html'],
  '/panel/style.css': ['panel/style.css', 'text/css'],
  '/panel/main.js': ['panel/main.js', 'application/javascript'],
};
const root = new URL('../', import.meta.url);
const server = createServer(async (request, response) => {
  const entry = routes[new URL(request.url, 'http://localhost').pathname];
  if (!entry) { response.writeHead(404); response.end(); return; }
  try {
    const content = await readFile(fileURLToPath(new URL(entry[0], root)));
    response.writeHead(200, { 'Content-Type': `${entry[1]}; charset=utf-8`, 'Cache-Control': 'no-store' });
    response.end(content);
  } catch { response.writeHead(500); response.end('Run npm run build first'); }
});
server.listen(Number(process.env.PORT ?? 4187), '127.0.0.1', () => console.log(`Preview: http://127.0.0.1:${server.address().port}`));
server.on('error', (error) => { console.error(error.message); process.exit(1); });
