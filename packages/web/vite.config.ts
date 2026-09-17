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
  /** Loads a workspace module through vite so its TypeScript is transformed. */
  ssrLoadModule(id: string): Promise<any>;
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
      const json = (res: DevResponse, status: number, body: unknown) => {
        res.statusCode = status;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(body));
      };

      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';

        const file = /^\/fixtures\/(index|exceptions)\.json$/.exec(url);
        if (file) {
          try {
            const text = await readFile(resolve(repoRoot, `${file[1]}.json`), 'utf8');
            res.setHeader('content-type', 'application/json');
            res.end(text);
          } catch {
            json(res, 404, { error: 'run `npm run index` first' });
          }
          return;
        }

        // One account, assembled from the files on disk with the real domain
        // logic, so the account page can be developed and reviewed without
        // deploying the Worker or reaching GitHub.
        const detail = /^\/fixtures\/customer\/([a-z0-9-]+)$/.exec(url);
        if (detail) {
          try {
            const core = await server.ssrLoadModule('@cs/core');
            const node = await server.ssrLoadModule('@cs/core/node');
            const source = node.fsSource(repoRoot);
            const record = await core.loadCustomer(source, detail[1]!);
            const asOf = core.parseDate(new Date().toISOString().slice(0, 10));
            json(res, 200, {
              ...record,
              base_sha: 'dev-fixture',
              health: core.evaluateHealth(record, asOf),
              gate: core.gateProgress(record, asOf),
              transitions: core.LIFECYCLE_STAGES.filter(
                (st: string) => st !== record.customer.lifecycle_stage,
              ).map((to: string) => ({ to, ...core.evaluateGate(record, to, asOf) })),
            });
          } catch (err) {
            json(res, 404, { error: (err as Error).message });
          }
          return;
        }

        next();
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
