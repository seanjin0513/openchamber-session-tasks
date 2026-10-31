import { createServer } from 'node:http';
import { join } from 'node:path';
import { readReport } from './store';
import { companionPath, inspectCompanion, installCompanion } from './installer';

const port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
const token = process.env.OPENCHAMBER_SERVICE_TOKEN;
if (!Number.isInteger(port) || port < 1 || port > 65535 || !token) throw new Error('OpenChamber service environment is missing');
const companionSource = join(__dirname, '..', 'companion');

const server = createServer(async (request, response) => {
  const send = (status: number, body: unknown) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
  };
  if (request.headers.authorization !== `Bearer ${token}`) return send(401, { error: 'Unauthorized' });
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/health' && request.method === 'GET') return send(200, { ok: true });
  if (url.pathname === '/companion') {
    if (request.method !== 'GET') return send(405, { error: 'Use POST /companion/install to install' });
    try { return send(200, await inspectCompanion(companionSource)); }
    catch { return send(500, { error: 'Reporter status could not be read' }); }
  }
  if (url.pathname === '/companion/install') {
    if (request.method !== 'POST') return send(405, { error: 'Use POST to install' });
    let input: unknown;
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 4000) return send(413, { error: 'Request too large' });
        chunks.push(chunk);
      }
      input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { return send(400, { error: 'Invalid JSON' }); }
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some((key) => !['confirmed', 'path'].includes(key))
      || (input as Record<string, unknown>).confirmed !== true
      || (input as Record<string, unknown>).path !== companionPath) return send(400, { error: 'Confirmation and exact install path are required' });
    try {
      const result = await installCompanion(companionSource);
      return send(200, result);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('COMPANION_CONFLICT')) return send(409, { error: 'Target contains files not owned by this extension' });
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return send(409, { error: 'Installation already in progress' });
      return send(500, { error: 'Reporter installation failed' });
    }
  }
  if (request.method !== 'GET') return send(405, { error: 'Method not allowed' });
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
