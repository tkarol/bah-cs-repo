import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const repoRoot = resolve(import.meta.dirname, '../..');

/** A minimal structural type for what this plugin touches. Vite's own `Plugin`
 *  type is not used here: vitest and this package resolve different major
 *  versions of vite, and the two `Plugin` types are not interchangeable. */
interface DevServer {
  middlewares: {
    use(fn: (req: { url?: string }, res: DevResponse, next: () => void) => void): void;
  };
}
interface DevResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body: string): void;
}

/**
 * Serves the generated index straight from the repo during `vite dev`, so the
 * UI can be driven by real data without deploying the Worker. Dev only — the
 * build never includes it, and production always talks to /api.
 */
function fixtures() {
  return {
    name: 'cs-fixtures',
    apply: 'serve' as const,
    configureServer(server: DevServer) {
      server.middlewares.use(async (req, res, next) => {
        const match = /^\/fixtures\/(index|exceptions)\.json$/.exec(req.url ?? '');
        if (!match) return next();
        try {
          const text = await readFile(resolve(repoRoot, `${match[1]}.json`), 'utf8');
          res.setHeader('content-type', 'application/json');
          res.end(text);
        } catch {
          res.statusCode = 404;
          res.end('{"error":"run `npm run index` first"}');
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), fixtures()],
  server: {
    // Point at a locally running Worker (`npm run dev:worker`).
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true } },
  },
  build: { outDir: 'dist', sourcemap: true },
});
