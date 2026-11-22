// Tiny static server bound to 127.0.0.1: serves the built scene (dist/web) at / and a job
// directory's timeline + audio at /job/. Only whitelisted file types are served.
import { createServer, type Server } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wav': 'audio/wav',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};
// Only these files from the job dir are exposed (never .env, tokens, etc.).
const JOB_ALLOW = /^(timeline\.json|audio\/[a-z0-9-]+\.wav)$/;

export interface StaticServer {
  url: string;
  close(): Promise<void>;
}

export async function startServer(webDir: string, jobDir: string, port = 0): Promise<StaticServer> {
  const webRoot = resolve(webDir);
  const jobRoot = resolve(jobDir);
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    let path = decodeURIComponent(url.pathname);
    let root = webRoot;
    if (path.startsWith('/job/')) {
      const rel = path.slice(5);
      if (!JOB_ALLOW.test(rel)) return send404();
      root = jobRoot;
      path = rel;
    } else if (path === '/') path = 'index.html';
    const file = normalize(join(root, path));
    if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) return send404();
    const type = TYPES[extname(file)];
    if (!type) return send404();
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    createReadStream(file).pipe(res);

    function send404() {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    }
  });
  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => ok());
  });
  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  return {
    url: `http://127.0.0.1:${actualPort}`,
    close: () => new Promise((ok) => server.close(() => ok())),
  };
}
