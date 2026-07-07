import type { Database } from 'bun:sqlite';

import { listActiveNrTaxonomyTerms } from './db';

type TagCountRow = {
  tag: string;
  count: number;
};

function listTagCounts(db: Database, type: 'topic' | 'mood'): TagCountRow[] {
  return db
    .prepare(
      `
      SELECT tag, COUNT(DISTINCT event_id) AS count
      FROM nr_event_tags
      WHERE type = ?
      GROUP BY tag
      ORDER BY count DESC, tag COLLATE NOCASE ASC
    `,
    )
    .all(type) as TagCountRow[];
}

function formatTagCounts(rows: TagCountRow[]): string {
  if (rows.length === 0) {
    return '(none yet)';
  }

  return rows.map((row) => `${row.tag} (${row.count})`).join(', ');
}

function formatManualTags(tags: string[]): string {
  return tags.length > 0 ? tags.join(', ') : '(none yet)';
}

export function buildNrPluginContextText(db: Database): string {
  const topicCounts = listTagCounts(db, 'topic');
  const moodCounts = listTagCounts(db, 'mood');

  const manualTopics = listActiveNrTaxonomyTerms({ db, type: 'topic' }).map(
    (term) => term.tag,
  );

  const manualMoods = listActiveNrTaxonomyTerms({ db, type: 'mood' }).map(
    (term) => term.tag,
  );

  return [
    'Use this existing taxonomy to consolidate similar tags instead of inventing near-duplicates.',
    `Preferred manual topics: ${formatManualTags(manualTopics)}`,
    `Preferred manual moods: ${formatManualTags(manualMoods)}`,
    `Current topics: ${formatTagCounts(topicCounts)}`,
    `Current moods: ${formatTagCounts(moodCounts)}`,
  ].join('\n');
}
