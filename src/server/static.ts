import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HttpResponse, TemplatedApp } from 'uWebSockets.js';

const CHAT_EXAMPLE_DIR = fileURLToPath(
  new URL('../../examples/chat/', import.meta.url),
);

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export class ChatExampleRoutes {
  readonly #root: string;

  constructor({ root = CHAT_EXAMPLE_DIR }: { root?: string } = {}) {
    this.#root = root;
  }

  install({ app }: { app: TemplatedApp }): void {
    app.get('/', (res) => {
      redirect({ res, location: '/examples/chat/' });
    });

    app.get('/examples/chat', (res) => {
      redirect({ res, location: '/examples/chat/' });
    });

    app.get('/examples/chat/', (res) => {
      serveFile({ res, root: this.#root, requestedPath: 'index.html' });
    });

    app.get('/examples/chat/*', (res, req) => {
      const path = req.getUrl().slice('/examples/chat/'.length);
      serveFile({ res, root: this.#root, requestedPath: path });
    });
  }
}

function redirect({
  res,
  location,
}: {
  res: HttpResponse;
  location: string;
}): void {
  res
    .writeStatus('302 Found')
    .writeHeader('location', location)
    .end('Redirecting');
}

function serveFile({
  res,
  root,
  requestedPath,
}: {
  res: HttpResponse;
  root: string;
  requestedPath: string;
}): void {
  const filePath = resolveSafePath({ root, requestedPath });
  if (
    filePath === undefined ||
    !existsSync(filePath) ||
    !statSync(filePath).isFile()
  ) {
    res.writeStatus('404 Not Found').end('Not found');
    return;
  }

  res
    .writeHeader(
      'content-type',
      CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream',
    )
    .end(readFileSync(filePath));
}

function resolveSafePath({
  root,
  requestedPath,
}: {
  root: string;
  requestedPath: string;
}): string | undefined {
  const filePath = normalize(join(root, requestedPath));
  const rootRelative = relative(root, filePath);

  if (rootRelative.startsWith('..') || rootRelative === '') {
    return undefined;
  }

  return filePath;
}
