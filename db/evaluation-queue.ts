import type { Database as DatabaseType } from 'bun:sqlite';

import type { NostrEvent } from '../commands/shared/types';

import {
  rowToNrEvaluationQueueItem,
  safeParseStringArray,
  type EnqueueNrEvaluationProps,
  type EvaluationQueueRow,
  type FinishNrEvaluationProps,
  type NrEvaluationQueueItem,
  type RecoverNrEvaluationQueueProps,
} from './types';

export const NR_EVALUATION_QUEUE_COMPLETED_LIMIT = 10_000;

export function enqueueNrEvaluation({
  db,
  event,
  relayHints,
}: EnqueueNrEvaluationProps): boolean {
  return db.transaction(() => {
    const existing = db
      .prepare(
        'SELECT relay_hints_json, status FROM nr_evaluation_queue WHERE event_id = ?',
      )
      .get(event.id) as
      | { relay_hints_json: string; status: EvaluationQueueRow['status'] }
      | undefined;

    const now = Date.now();

    const hints = [
      ...new Set([
        ...(existing ? safeParseStringArray(existing.relay_hints_json) : []),
        ...relayHints,
      ]),
    ];

    if (!existing) {
      db.run(
        `INSERT INTO nr_evaluation_queue (
          event_id, raw_event_json, relay_hints_json, status, attempts, error, created_at, updated_at, processing_started_at
        ) VALUES (?, ?, ?, 'pending', 0, NULL, ?, ?, NULL)`,
        [event.id, JSON.stringify(event), JSON.stringify(hints), now, now],
      );

      db.run(
        `DELETE FROM nr_evaluation_queue
         WHERE event_id IN (
           SELECT event_id
           FROM nr_evaluation_queue
           WHERE status = 'completed'
           ORDER BY updated_at DESC
           LIMIT -1 OFFSET ?
         )`,
        [NR_EVALUATION_QUEUE_COMPLETED_LIMIT],
      );

      return true;
    }

    db.run(
      `UPDATE nr_evaluation_queue
       SET raw_event_json = ?,
           relay_hints_json = ?,
           status = CASE WHEN status = 'failed' THEN 'pending' ELSE status END,
           error = CASE WHEN status = 'failed' THEN NULL ELSE error END,
           processing_started_at = CASE WHEN status = 'failed' THEN NULL ELSE processing_started_at END,
           updated_at = ?
       WHERE event_id = ?`,
      [JSON.stringify(event), JSON.stringify(hints), now, event.id],
    );

    db.run(
      `DELETE FROM nr_evaluation_queue
       WHERE event_id IN (
         SELECT event_id
         FROM nr_evaluation_queue
         WHERE status = 'completed'
         ORDER BY updated_at DESC
         LIMIT -1 OFFSET ?
       )`,
      [NR_EVALUATION_QUEUE_COMPLETED_LIMIT],
    );

    return false;
  })();
}

export function recoverNrEvaluationQueue({
  db,
  staleBeforeMs,
}: RecoverNrEvaluationQueueProps): number {
  const result = db.run(
    `UPDATE nr_evaluation_queue
     SET status = 'pending',
         error = 'Recovered stale processing claim.',
         processing_started_at = NULL,
         updated_at = ?
     WHERE status = 'processing' AND processing_started_at < ?`,
    [Date.now(), staleBeforeMs],
  );

  return result.changes;
}

export function claimNrEvaluation(
  db: DatabaseType,
): NrEvaluationQueueItem | null {
  return db.transaction(() => {
    const row = db
      .prepare(
        `SELECT * FROM nr_evaluation_queue
         WHERE status = 'pending'
         ORDER BY created_at ASC
         LIMIT 1`,
      )
      .get() as EvaluationQueueRow | undefined;

    if (!row) {
      return null;
    }

    const now = Date.now();

    db.run(
      `UPDATE nr_evaluation_queue
       SET status = 'processing', attempts = attempts + 1, processing_started_at = ?, updated_at = ?
       WHERE event_id = ? AND status = 'pending'`,
      [now, now, row.event_id],
    );

    const claimed = db
      .prepare('SELECT * FROM nr_evaluation_queue WHERE event_id = ?')
      .get(row.event_id) as EvaluationQueueRow | undefined;

    const item = claimed ? rowToNrEvaluationQueueItem(claimed) : null;

    if (item) {
      return item;
    }

    db.run(
      `UPDATE nr_evaluation_queue
       SET status = 'failed', error = 'Stored queue event is invalid JSON.', processing_started_at = NULL, updated_at = ?
       WHERE event_id = ?`,
      [Date.now(), row.event_id],
    );

    return null;
  })();
}

export function completeNrEvaluation({
  db,
  eventId,
  error,
}: FinishNrEvaluationProps): void {
  db.run(
    `UPDATE nr_evaluation_queue
     SET status = 'completed', error = ?, processing_started_at = NULL, updated_at = ?
     WHERE event_id = ? AND status = 'processing'`,
    [error, Date.now(), eventId],
  );
}

export function failNrEvaluation({
  db,
  eventId,
  error,
}: FinishNrEvaluationProps): void {
  db.run(
    `UPDATE nr_evaluation_queue
     SET status = 'failed', error = ?, processing_started_at = NULL, updated_at = ?
     WHERE event_id = ? AND status = 'processing'`,
    [error, Date.now(), eventId],
  );
}
