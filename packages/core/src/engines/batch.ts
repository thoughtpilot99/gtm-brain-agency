import { get, now, run } from "../db";

export const BATCH_SIZE = 100;

export interface BatchProgress {
  jobId: string;
  total: number;
  done: number;
  status: "running" | "done" | "failed" | "paused";
  error?: string;
}

/**
 * Process items in checkpointed batches of 100 (house rule 1).
 * If a run dies halfway, calling it again with the same jobId resumes at the last finished batch.
 * `stopAfterBatches` lets a caller do one batch, review it, then continue.
 */
export async function runBatches<T>(
  client: string,
  jobId: string,
  kind: string,
  items: T[],
  fn: (batch: T[], offset: number) => Promise<void>,
  opts: { size?: number; stopAfterBatches?: number; onProgress?: (p: BatchProgress) => void } = {},
): Promise<BatchProgress> {
  const size = opts.size ?? BATCH_SIZE;
  const existing = get<{ cursor: number; status: string; total: number }>("SELECT cursor, status, total FROM jobs WHERE id = ?", jobId);
  let cursor = existing && existing.total === items.length && existing.status !== "done" ? existing.cursor : 0;
  run(
    `INSERT INTO jobs (id, client, kind, total, cursor, status, updated_at) VALUES (?,?,?,?,?,'running',?)
     ON CONFLICT(id) DO UPDATE SET total=excluded.total, cursor=?, status='running', error=NULL, updated_at=excluded.updated_at`,
    jobId,
    client,
    kind,
    items.length,
    cursor,
    now(),
    cursor,
  );
  let batches = 0;
  while (cursor < items.length) {
    const batch = items.slice(cursor, cursor + size);
    try {
      await fn(batch, cursor);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      run("UPDATE jobs SET status='failed', error=?, updated_at=? WHERE id=?", msg, now(), jobId);
      return { jobId, total: items.length, done: cursor, status: "failed", error: msg };
    }
    cursor += batch.length;
    batches++;
    run("UPDATE jobs SET cursor=?, updated_at=? WHERE id=?", cursor, now(), jobId);
    opts.onProgress?.({ jobId, total: items.length, done: cursor, status: "running" });
    if (opts.stopAfterBatches && batches >= opts.stopAfterBatches && cursor < items.length) {
      run("UPDATE jobs SET status='paused', updated_at=? WHERE id=?", now(), jobId);
      return { jobId, total: items.length, done: cursor, status: "paused" };
    }
  }
  run("UPDATE jobs SET status='done', updated_at=? WHERE id=?", now(), jobId);
  return { jobId, total: items.length, done: cursor, status: "done" };
}
