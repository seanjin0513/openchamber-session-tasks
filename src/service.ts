import { createServer } from 'node:http';
import { readReport } from './store';

const port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
const token = process.env.OPENCHAMBER_SERVICE_TOKEN;
if (!Number.isInteger(port) || port < 1 || port > 65535 || !token) throw new Error('OpenChamber service environment is missing');

const server = createServer(async (request, response) => {
  const send = (status: number, body: unknown) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
  };
  if (request.headers.authorization !== `Bearer ${token}`) return send(401, { error: 'Unauthorized' });
  if (request.method !== 'GET') return send(405, { error: 'Read-only service' });
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/health') return send(200, { ok: true });
  if (url.pathname !== '/tasks') return send(404, { error: 'Not found' });
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId || !/^[a-zA-Z0-9_-]{1,96}$/.test(sessionId)) return send(400, { error: 'Invalid session ID' });
  try { return send(200, { report: await readReport(sessionId) }); }
  catch { return send(500, { error: 'Task report could not be read' }); }
});
server.requestTimeout = 5000;
server.listen(port, '127.0.0.1');
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
