import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker, { OffcutOrders } from '../worker.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
class SqlMock {
  constructor() { this.db = new DatabaseSync(':memory:'); }
  exec(query, ...args) {
    const statement = this.db.prepare(query);
    if (/^\s*(SELECT|PRAGMA|WITH)\b/i.test(query)) return { toArray: () => statement.all(...args) };
    return statement.run(...args);
  }
}
const sql = new SqlMock();
const storage = { sql, transactionSync(callback) { sql.db.exec('BEGIN IMMEDIATE'); try { const value = callback(); sql.db.exec('COMMIT'); return value; } catch (error) { sql.db.exec('ROLLBACK'); throw error; } }, async setAlarm() {} };
const ctx = { storage };
const env = {
  ALLOWED_ORIGINS: 'http://127.0.0.1:4173,http://localhost:4173',
  GMAIL_RELAY_URL: '', RELAY_SECRET: '', ADMIN_SECRET: '',
  ORDERS: null
};
const durable = new OffcutOrders(ctx, env);
env.ORDERS = { idFromName: () => 'offcut-local-test', get: () => ({ fetch: request => durable.fetch(request) }) };

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg' };
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:4173');
  if (url.pathname === '/orders' || url.pathname === '/admin') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) if (typeof value === 'string') headers.set(key, value);
    const upstream = await worker.fetch(new Request(`http://127.0.0.1:4173${url.pathname}`, { method: request.method, headers, body: ['GET', 'HEAD', 'OPTIONS'].includes(request.method) ? undefined : body }), env);
    response.writeHead(upstream.status, Object.fromEntries(upstream.headers));
    response.end(Buffer.from(await upstream.arrayBuffer()));
    return;
  }
  let file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
  if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
  if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  try {
    const data = await import('node:fs/promises').then(fs => fs.readFile(file));
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(data);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});

server.listen(4173, '127.0.0.1', () => console.log('OFFCUT isolated test server: http://127.0.0.1:4173'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { sql.db.close(); process.exit(0); }));
