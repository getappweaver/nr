import type { NostrEvent } from '../shared/types';

export const NR_FEED_CATEGORIES = [
  'posts',
  'long-form',
  'replies',
  'comments',
  'highlights',
  'reposts',
  'quotes',
  'reactions',
] as const;

export type NrFeedCategory = (typeof NR_FEED_CATEGORIES)[number];

export const DEFAULT_NR_FEED_CATEGORIES: NrFeedCategory[] = [
  ...NR_FEED_CATEGORIES,
];

export const NR_FEED_CATEGORY_LABELS: Record<NrFeedCategory, string> = {
  posts: 'Posts',
  'long-form': 'Long-form posts',
  replies: 'Replies',
  comments: 'NIP-22 comments',
  highlights: 'Highlights',
  reposts: 'Reposts',
  quotes: 'Quotes',
  reactions: 'Likes / Reactions',
};

export function normalizeNrFeedCategories(value: unknown): NrFeedCategory[] {
  const values = Array.isArray(value)
    ? value
    : value === undefined
      ? []
      : [value];

  const selected = new Set(
    values.filter(
      (item): item is NrFeedCategory =>
        typeof item === 'string' &&
        NR_FEED_CATEGORIES.includes(item as NrFeedCategory),
    ),
  );

  return selected.size > 0
    ? NR_FEED_CATEGORIES.filter((category) => selected.has(category))
    : [...DEFAULT_NR_FEED_CATEGORIES];
}

export function kindsForNrFeedCategories(
  categories: NrFeedCategory[],
): number[] {
  const kinds = new Set<number>();

  if (
    categories.some((category) =>
      ['posts', 'replies', 'quotes'].includes(category),
    )
  ) {
    kinds.add(1);
  }

  if (categories.includes('comments')) {
    kinds.add(1111);
  }

  if (categories.includes('long-form')) {
    kinds.add(30023);
  }

  if (categories.includes('highlights')) {
    kinds.add(9802);
  }

  if (categories.includes('reposts')) {
    kinds.add(6);
    kinds.add(16);
  }

  if (categories.includes('reactions')) {
    kinds.add(7);
  }

  return [...kinds];
}

export function categoryForNrEvent(event: NostrEvent): NrFeedCategory | null {
  if (event.kind === 1) {
    if (event.tags.some((tag) => tag[0] === 'q' && tag[1]?.trim())) {
      return 'quotes';
    }

    if (event.tags.some((tag) => tag[0] === 'e' && tag[1]?.trim())) {
      return 'replies';
    }

    return 'posts';
  }

  if (event.kind === 1111) {
    return 'comments';
  }

  if (event.kind === 30023) {
    return 'long-form';
  }

  if (event.kind === 9802) {
    return 'highlights';
  }

  if (event.kind === 6 || event.kind === 16) {
    return 'reposts';
  }

  if (event.kind === 7) {
    return 'reactions';
  }

  return null;
}
