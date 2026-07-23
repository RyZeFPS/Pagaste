import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, relative, resolve } from 'node:path';

const root = resolve('dist');
const port = Number(process.env.PORT ?? 8081);
const idleArgument = process.argv.find((argument) => argument.startsWith('--idle-timeout='));
const idleTimeout = idleArgument ? Number(idleArgument.split('=')[1]) : 0;
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

async function existingFile(pathname) {
  const candidate = resolve(root, `.${pathname}`);
  if (relative(root, candidate).startsWith('..')) return undefined;
  try {
    const details = await stat(candidate);
    return details.isFile() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

let idleTimer;
function resetIdleTimer() {
  if (!Number.isFinite(idleTimeout) || idleTimeout <= 0) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    server.close(() => process.exit(0));
    setTimeout(() => server.closeAllConnections(), 1_000).unref();
  }, idleTimeout);
}

const server = createServer(async (request, response) => {
  resetIdleTimer();
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405).end();
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  } catch {
    response.writeHead(400).end();
    return;
  }
  const file = (await existingFile(pathname)) ?? resolve(root, 'index.html');
  response.setHeader('Content-Type', mimeTypes[extname(file)] ?? 'application/octet-stream');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method === 'HEAD') {
    response.writeHead(200).end();
    return;
  }
  createReadStream(file)
    .on('error', () => response.writeHead(500).end())
    .pipe(response);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Pagaste production build: http://127.0.0.1:${port}`);
  resetIdleTimer();
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
