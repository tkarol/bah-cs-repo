/** A FileSource backed by the GitHub API, so core's loader works unchanged in
 *  the Worker. The recursive tree is fetched once per request and reused. */
import type { FileSource } from '@cs/core';
import { getFile, getTree, type TreeEntry } from './github.ts';
import type { Env } from './env.ts';

export function githubSource(env: Env): FileSource & { prime(): Promise<void> } {
  let tree: TreeEntry[] | null = null;

  async function ensureTree(): Promise<TreeEntry[]> {
    if (!tree) tree = await getTree(env);
    return tree;
  }

  return {
    async prime() {
      await ensureTree();
    },
    async list(dir) {
      const entries = await ensureTree();
      const prefix = `${dir}/`;
      return entries
        .filter((e) => e.type === 'blob' && e.path.startsWith(prefix))
        .map((e) => e.path)
        .filter((p) => !p.slice(prefix.length).includes('/'));
    },
    async listDirs(dir) {
      const entries = await ensureTree();
      const prefix = `${dir}/`;
      const out = new Set<string>();
      for (const e of entries) {
        if (!e.path.startsWith(prefix)) continue;
        const rest = e.path.slice(prefix.length);
        const head = rest.split('/')[0];
        if (head && rest.includes('/')) out.add(head);
      }
      return [...out].sort();
    },
    async read(path) {
      const file = await getFile(env, path);
      return file?.text ?? null;
    },
  };
}
