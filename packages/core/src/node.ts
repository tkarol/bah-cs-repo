/** Filesystem-backed FileSource, for the indexer CLI and CI validation.
 *  Kept out of `index.ts` so the Worker bundle never pulls in `node:fs`. */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { FileSource } from './load.ts';

export function fsSource(root: string): FileSource {
  return {
    async list(dir) {
      try {
        const entries = await readdir(join(root, dir), { withFileTypes: true });
        return entries.filter((e) => e.isFile()).map((e) => `${dir}/${e.name}`);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw err;
      }
    },
    async listDirs(dir) {
      try {
        const entries = await readdir(join(root, dir), { withFileTypes: true });
        return entries.filter((e) => e.isDirectory()).map((e) => e.name);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw err;
      }
    },
    async read(path) {
      try {
        return await readFile(join(root, path), 'utf8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
    },
  };
}
