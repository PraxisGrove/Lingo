import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.zip': 'application/zip',
};
createServer(async (request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (path === '/') {
    response.writeHead(302, { location: '/docs/brand/index.html' });
    response.end();
    return;
  }
  const relative = path.slice(1);
  const filename = resolve(root, relative);
  if (
    !filename.startsWith(root) ||
    !['docs/brand/', 'public/brand/', 'public/icon/'].some((prefix) =>
      relative.startsWith(prefix),
    )
  ) {
    response.writeHead(404);
    response.end();
    return;
  }
  try {
    const extension = filename.slice(filename.lastIndexOf('.'));
    if (!types[extension]) throw new Error('Unsupported preview asset');
    response.writeHead(200, {
      'content-type': types[extension],
      'cache-control': 'no-store',
    });
    response.end(await readFile(filename));
  } catch {
    response.writeHead(404);
    response.end();
  }
}).listen(4174, '127.0.0.1', () =>
  process.stdout.write('Lingo brand preview: http://127.0.0.1:4174/\n'),
);
