// Local dev server: serves /public and runs the /api handlers the same way Vercel does.
// Usage: npm run dev  ->  http://localhost:3000

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));

const PORT = Number(process.env.PORT) || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    try {
      if (url.pathname.startsWith('/api/')) {
        const name = url.pathname.slice(5).replace(/[^a-z0-9-]/gi, '');
        const file = path.join(root, 'api', `${name}.js`);
        if (!existsSync(file)) return send(res, 404, 'Not found');
        const mod = await import(pathToFileURL(file).href);
        const handler = mod[req.method];
        if (!handler) return send(res, 405, 'Method not allowed');
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const request = new Request(url, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
        const response = await handler(request);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        return res.end(Buffer.from(await response.arrayBuffer()));
      }
      const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const file = path.join(root, 'public', rel);
      if (!file.startsWith(path.join(root, 'public')) || !existsSync(file)) return send(res, 404, 'Not found');
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(await readFile(file));
    } catch (err) {
      console.error(err);
      send(res, 500, 'Server error');
    }
  })
  .listen(PORT, () => {
    console.log(`JobAlert running at http://localhost:${PORT}`);
    console.log(process.env.ANTHROPIC_API_KEY ? 'AI drafting: on' : 'AI drafting: off (add ANTHROPIC_API_KEY to .env to turn it on)');
  });

function send(res, status, msg) {
  res.writeHead(status, { 'Content-Type': 'text/plain' });
  res.end(msg);
}
