/**
 * The write path.
 *
 * Two concurrency modes, both built on the blob SHA GitHub returns with every
 * read:
 *
 *  - Strict: the caller passes the SHA its edit was based on. A mismatch is a
 *    409 and the UI reloads — this is what stops two people silently
 *    overwriting each other's edits to the same customer.
 *  - Retry: for derived edits where the mutation is safe to reapply (accepting
 *    a commitment, acknowledging ownership), re-read and reapply on conflict.
 *
 * Every write is schema-validated before it reaches the repo, so a malformed
 * document cannot be committed through this API at all.
 */
import { stringify as toYaml } from 'yaml';
import { parse as parseYaml } from 'yaml';
import { ConflictError, getFile, putFile } from './github.ts';
import type { Env } from './env.ts';

export class BadRequest extends Error {
  readonly status = 400;
  readonly issues: string[];
  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = 'BadRequest';
    this.issues = issues;
  }
}

export class StaleWrite extends Error {
  readonly status = 409;
  constructor(public readonly path: string) {
    super(`${path} changed since you loaded it. Reload and reapply your edit.`);
    this.name = 'StaleWrite';
  }
}

const MAX_ATTEMPTS = 3;

export interface YamlWriteArgs<T> {
  path: string;
  /** Applies the edit. Receives the current document, returns the new one. */
  mutate: (current: T) => T;
  /** Validates the result before it is committed. Throws BadRequest on failure. */
  validate: (candidate: unknown) => T;
  message: string;
  actor: string;
  /** When set, the write is rejected outright if the file has moved on. */
  expectedSha?: string | null;
  /** Allows creating the file when it does not exist. */
  createIfMissing?: boolean;
}

export async function writeYaml<T>(env: Env, args: YamlWriteArgs<T>): Promise<{ sha: string; commit: string }> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const existing = await getFile(env, args.path);

    if (!existing && !args.createIfMissing) {
      throw new BadRequest(`${args.path} does not exist.`);
    }
    if (args.expectedSha !== undefined && args.expectedSha !== null) {
      if (!existing || existing.sha !== args.expectedSha) throw new StaleWrite(args.path);
    }

    const current = (existing ? parseYaml(existing.text) : {}) as T;
    const next = args.validate(args.mutate(current));

    try {
      return await putFile(env, {
        path: args.path,
        text: toYaml(next, { lineWidth: 100 }),
        baseSha: existing?.sha ?? null,
        message: args.message,
        actor: args.actor,
      });
    } catch (err) {
      if (!(err instanceof ConflictError)) throw err;
      // A strict caller must be told; it cannot know whether reapplying is safe.
      if (args.expectedSha !== undefined) throw new StaleWrite(args.path);
      if (attempt === MAX_ATTEMPTS) throw new StaleWrite(args.path);
      // Otherwise fall through and reapply against the newer document.
    }
  }
  throw new StaleWrite(args.path);
}

export async function writeText(
  env: Env,
  args: { path: string; text: string; message: string; actor: string; mustNotExist?: boolean },
): Promise<{ sha: string; commit: string }> {
  const existing = await getFile(env, args.path);
  if (existing && args.mustNotExist) {
    throw new BadRequest(`${args.path} already exists.`);
  }
  return putFile(env, {
    path: args.path,
    text: args.text,
    baseSha: existing?.sha ?? null,
    message: args.message,
    actor: args.actor,
  });
}

/** Turns a Zod result into a BadRequest carrying every field error at once. */
export function validateWith<T>(schema: { safeParse: (v: unknown) => any }, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequest(
      `${what} is not valid.`,
      result.error.issues.map((i: any) => `${i.path.join('.') || '<root>'}: ${i.message}`),
    );
  }
  return result.data as T;
}
