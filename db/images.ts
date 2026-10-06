import type { Database as DatabaseType } from 'bun:sqlite';

import type {
  NrEventImage,
  NrEventImageEvaluation,
  NrImageCacheEntry,
} from './types';

export type SaveNrImageCacheProps = {
  db: DatabaseType;
  imageHash: string;
  mime: string;
  byteSize: number;
  description: string;
  model: string;
};

export function getNrImageCache(
  db: DatabaseType,
  imageHash: string,
): NrImageCacheEntry | null {
  const row = db
    .prepare(
      `SELECT image_hash, mime, byte_size, description, model, evaluated_at
       FROM nr_image_cache WHERE image_hash = ?`,
    )
    .get(imageHash) as {
    image_hash: string;
    mime: string;
    byte_size: number;
    description: string;
    model: string;
    evaluated_at: number;
  } | null;

  if (!row) {
    return null;
  }

  return {
    imageHash: row.image_hash,
    mime: row.mime,
    byteSize: row.byte_size,
    description: row.description,
    model: row.model,
    evaluatedAt: row.evaluated_at,
  };
}

export function saveNrImageCache({
  db,
  imageHash,
  mime,
  byteSize,
  description,
  model,
}: SaveNrImageCacheProps): NrImageCacheEntry {
  const now = Math.floor(Date.now() / 1000);

  db.run(
    `INSERT INTO nr_image_cache (image_hash, mime, byte_size, description, model, evaluated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(image_hash) DO UPDATE SET
       mime = excluded.mime,
       byte_size = excluded.byte_size,
       description = excluded.description,
       model = excluded.model,
       evaluated_at = excluded.evaluated_at`,
    [imageHash, mime, byteSize, description, model, now],
  );

  return {
    imageHash,
    mime,
    byteSize,
    description,
    model,
    evaluatedAt: now,
  };
}

export type SaveNrEventImageProps = {
  db: DatabaseType;
  eventId: string;
  imageHash: string;
  sourceUrl: string;
};

export function saveNrEventImage({
  db,
  eventId,
  imageHash,
  sourceUrl,
}: SaveNrEventImageProps): void {
  db.run(
    `INSERT OR IGNORE INTO nr_event_images (event_id, image_hash, source_url)
     VALUES (?, ?, ?)`,
    [eventId, imageHash, sourceUrl],
  );
}

export function listNrEventImages(
  db: DatabaseType,
  eventId: string,
): NrEventImage[] {
  const rows = db
    .prepare(
      `SELECT event_id, image_hash, source_url
       FROM nr_event_images WHERE event_id = ? ORDER BY image_hash ASC`,
    )
    .all(eventId) as {
    event_id: string;
    image_hash: string;
    source_url: string;
  }[];

  return rows.map((row) => ({
    eventId: row.event_id,
    imageHash: row.image_hash,
    sourceUrl: row.source_url,
  }));
}

export function listNrEventImageEvaluations(
  db: DatabaseType,
  eventId: string,
): NrEventImageEvaluation[] {
  const rows = db
    .prepare(
      `SELECT ei.event_id, ei.image_hash, ei.source_url,
              c.mime, c.byte_size, c.description, c.model, c.evaluated_at
       FROM nr_event_images ei
       JOIN nr_image_cache c ON c.image_hash = ei.image_hash
       WHERE ei.event_id = ? ORDER BY ei.image_hash ASC`,
    )
    .all(eventId) as {
    event_id: string;
    image_hash: string;
    source_url: string;
    mime: string;
    byte_size: number;
    description: string;
    model: string;
    evaluated_at: number;
  }[];

  return rows.map((row) => ({
    eventId: row.event_id,
    imageHash: row.image_hash,
    sourceUrl: row.source_url,
    mime: row.mime,
    byteSize: row.byte_size,
    description: row.description,
    model: row.model,
    evaluatedAt: row.evaluated_at,
  }));
}

export function countNrEvaluatedImagesByEvent(
  db: DatabaseType,
): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT ei.event_id AS event_id, COUNT(*) AS count
       FROM nr_event_images ei
       JOIN nr_image_cache c ON c.image_hash = ei.image_hash
       GROUP BY ei.event_id`,
    )
    .all() as Array<{ event_id: string; count: number }>;

  return Object.fromEntries(rows.map((row) => [row.event_id, row.count]));
}
