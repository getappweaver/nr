import type { Database as DatabaseType } from 'bun:sqlite';

import type {
  NrTaxonomyTerm,
  NrTaxonomyTermType,
  SyncNrTaxonomyTermsProps,
  TaxonomyTermRow,
} from './types';
import { rowToNrTaxonomyTerm } from './types';

export function normalizeTaxonomyTag(tag: string): string {
  return tag.trim().toLowerCase();
}

export function listNrTaxonomyTerms(db: DatabaseType): NrTaxonomyTerm[] {
  const rows = db
    .prepare(
      `
      SELECT *
      FROM nr_taxonomy_terms
      ORDER BY type ASC, tag COLLATE NOCASE ASC
    `,
    )
    .all() as TaxonomyTermRow[];

  return rows.map(rowToNrTaxonomyTerm);
}

export function listActiveNrTaxonomyTerms({
  db,
  type,
}: {
  db: DatabaseType;
  type: NrTaxonomyTermType;
}): NrTaxonomyTerm[] {
  const rows = db
    .prepare(
      `
      SELECT *
      FROM nr_taxonomy_terms
      WHERE active = 1 AND type = ?
      ORDER BY tag COLLATE NOCASE ASC
    `,
    )
    .all(type) as TaxonomyTermRow[];

  return rows.map(rowToNrTaxonomyTerm);
}

export function syncNrTaxonomyTerms({
  db,
  type,
  interestedTags,
  uninterestedTags,
  newInterestedTag,
  newUninterestedTag,
}: SyncNrTaxonomyTermsProps): NrTaxonomyTerm[] {
  const now = Date.now();

  const desiredTerms = new Map<string, NrTaxonomyTerm['preference']>();

  for (const tag of interestedTags) {
    const normalized = normalizeTaxonomyTag(tag);

    if (normalized) {
      desiredTerms.set(normalized, 'interested');
    }
  }

  const normalizedNewInterestedTag = newInterestedTag
    ? normalizeTaxonomyTag(newInterestedTag)
    : '';

  if (normalizedNewInterestedTag) {
    desiredTerms.set(normalizedNewInterestedTag, 'interested');
  }

  for (const tag of uninterestedTags) {
    const normalized = normalizeTaxonomyTag(tag);

    if (normalized) {
      desiredTerms.set(normalized, 'uninterested');
    }
  }

  const normalizedNewUninterestedTag = newUninterestedTag
    ? normalizeTaxonomyTag(newUninterestedTag)
    : '';

  if (normalizedNewUninterestedTag) {
    desiredTerms.set(normalizedNewUninterestedTag, 'uninterested');
  }

  db.run(
    'UPDATE nr_taxonomy_terms SET active = 0, updated_at = ? WHERE type = ?',
    [now, type],
  );

  const upsert = db.prepare(
    `
    INSERT INTO nr_taxonomy_terms (
      type,
      tag,
      description,
      preference,
      active,
      created_at,
      updated_at
    ) VALUES (?, ?, NULL, ?, 1, ?, ?)
    ON CONFLICT(type, tag) DO UPDATE SET
      preference = excluded.preference,
      active = 1,
      updated_at = excluded.updated_at
  `,
  );

  for (const [tag, preference] of desiredTerms) {
    upsert.run(type, tag, preference, now, now);
  }

  return listActiveNrTaxonomyTerms({ db, type });
}
