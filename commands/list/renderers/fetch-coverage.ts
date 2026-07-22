import type { WebNode } from '@src/web/ui-schema';

import { NR_FETCH_STATUS_TARGET_ID } from '../../fetch-status';
import type {
  NrFetchStatus,
  NrFetchWindow,
  NrListData,
} from '../../shared/types';

type FetchBucket = {
  since: number;
  until: number;
  fetchSince: number;
  fetchUntil: number;
  status: NrFetchStatus | 'unfetched';
  eventCount: number;
};

type BucketStatus = Pick<FetchBucket, 'status' | 'eventCount'>;

const FETCH_COVERAGE_HOURS = 24;
const HOUR_SECONDS = 60 * 60;

export const fetchCoverageStylesheet = {
  id: 'nr-fetch-coverage',
  cssText: `
.nr-fetch-coverage-bar {
  display: grid;
  gap: 1px;
  min-width: 0;
}

.nr-fetch-label-row {
  display: grid;
  grid-template-columns: repeat(25, minmax(1.3rem, 1fr));
  gap: 2px;
  min-width: 0;
}

.nr-fetch-button-row {
  display: grid;
  width: calc(100% - (100% / 25));
  margin-left: calc(100% / 50);
  grid-template-columns: repeat(24, minmax(1.3rem, 1fr));
  gap: 2px;
  min-width: 0;
}

.nr-fetch-label {
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: 0.68rem;
  line-height: 1;
  text-align: center;
  text-overflow: clip;
  white-space: nowrap;
}

.nr-fetch-bucket {
  min-width: 0;
  height: 1.45rem;
  padding: 0;
  border: 0;
  background: color-mix(in srgb, var(--color-text-muted) 18%, transparent);
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 0;
  line-height: 1;
}

.nr-fetch-bucket:hover,
.nr-fetch-bucket:focus-visible {
  background: var(--color-warning);
  color: #000;
}

.nr-fetch-bucket--fetched {
  background: color-mix(in srgb, var(--color-success) 45%, transparent);
  color: var(--color-text);
}

.nr-fetch-bucket--partial {
  background: color-mix(in srgb, var(--color-warning) 55%, transparent);
  color: #000;
}

.nr-fetch-bucket--failed {
  background: color-mix(in srgb, var(--color-danger) 55%, transparent);
  color: var(--color-text);
}
`,
};

function text(value: string): WebNode {
  return { type: 'text', value };
}

function el(
  tag: Extract<WebNode, { type: 'element' }>['tag'],
  props: Record<string, unknown>,
  children: WebNode[],
): WebNode {
  return { type: 'element', tag, props, children } as WebNode;
}

function hourStart(timestampSeconds: number): number {
  return Math.floor(timestampSeconds / HOUR_SECONDS) * HOUR_SECONDS;
}

function hourLabel(timestampSeconds: number): string {
  return String(new Date(timestampSeconds * 1000).getHours());
}

function windowOverlapsBucket(
  window: NrFetchWindow,
  bucket: FetchBucket,
): boolean {
  return window.until > bucket.since && window.since < bucket.until;
}

type Interval = {
  since: number;
  until: number;
};

function clampIntervalToBucket(
  window: NrFetchWindow,
  bucket: FetchBucket,
): Interval | null {
  const since = Math.max(window.since, bucket.since);
  const until = Math.min(window.until, bucket.until);

  return until > since ? { since, until } : null;
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.since - b.since);
  const merged: Interval[] = [];

  for (const interval of sorted) {
    const previous = merged.at(-1);

    if (!previous || interval.since > previous.until) {
      merged.push({ ...interval });
      continue;
    }

    previous.until = Math.max(previous.until, interval.until);
  }

  return merged;
}

function coversBucket(intervals: Interval[], bucket: FetchBucket): boolean {
  return mergeIntervals(intervals).some(
    (interval) =>
      interval.since <= bucket.since && interval.until >= bucket.until,
  );
}

function latestCoveredUntil(
  windows: NrFetchWindow[],
  bucket: FetchBucket,
): number | null {
  const merged = mergeIntervals(
    windows
      .filter((window) => window.status !== 'failed')
      .map((window) => clampIntervalToBucket(window, bucket))
      .filter((interval): interval is Interval => interval !== null),
  );

  const firstInterval = merged.find(
    (interval) => interval.since <= bucket.since,
  );

  return firstInterval?.until ?? null;
}

function bucketStatus(
  windows: NrFetchWindow[],
  bucket: FetchBucket,
): BucketStatus {
  const overlaps = windows.filter((window) =>
    windowOverlapsBucket(window, bucket),
  );

  if (overlaps.length === 0) {
    return { status: 'unfetched', eventCount: 0 };
  }

  const eventCount = overlaps.reduce(
    (total, window) => total + window.eventCount,
    0,
  );

  const successfulIntervals = overlaps
    .filter((window) => window.status === 'fetched')
    .map((window) => clampIntervalToBucket(window, bucket))
    .filter((interval): interval is Interval => interval !== null);

  const hasPartial = overlaps.some((window) => window.status === 'partial');
  const hasSuccessful = overlaps.some((window) => window.status !== 'failed');

  if (!hasSuccessful) {
    return { status: 'failed', eventCount };
  }

  if (hasPartial || !coversBucket(successfulIntervals, bucket)) {
    return { status: 'partial', eventCount };
  }

  return { status: 'fetched', eventCount };
}

function fetchBuckets(fetchWindows: NrFetchWindow[]): FetchBucket[] {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const currentHourStart = hourStart(nowSeconds);

  return Array.from({ length: FETCH_COVERAGE_HOURS }, (_, index) => {
    const since = currentHourStart - index * HOUR_SECONDS;
    const until = since + HOUR_SECONDS;

    const emptyBucket: FetchBucket = {
      since,
      until,
      fetchSince: since,
      fetchUntil: index === 0 ? Math.max(nowSeconds, since + 1) : until,
      status: 'unfetched',
      eventCount: 0,
    };

    const coveredUntil = latestCoveredUntil(fetchWindows, emptyBucket);

    const fetchSince =
      coveredUntil && coveredUntil < emptyBucket.fetchUntil
        ? coveredUntil
        : emptyBucket.fetchSince;

    return {
      ...emptyBucket,
      fetchSince,
      ...bucketStatus(fetchWindows, emptyBucket),
    };
  });
}

function fetchBoundaryLabels(): string[] {
  const currentHourStart = hourStart(Math.floor(Date.now() / 1000));

  return Array.from({ length: FETCH_COVERAGE_HOURS + 1 }, (_, index) =>
    index === 0
      ? 'now'
      : hourLabel(currentHourStart - (index - 1) * HOUR_SECONDS),
  );
}

function fetchBucketAction(alias: string, bucket: FetchBucket) {
  return {
    type: 'command' as const,
    command: alias,
    subcommand: 'fetch-latest',
    arguments: {},
    options: {
      since: bucket.fetchSince,
      until: bucket.fetchUntil,
    },
    recordInTimeline: false,
    expandTreeItemIds: ['nr-fetch-progress'],
    refresh: {
      command: alias,
      subcommand: 'list',
      arguments: {},
      options: { mode: 'timeline' },
      expandTreeItemIds: ['nr-fetch-progress'],
      recordInTimeline: false,
    },
    clientStatus: {
      background: true,
      pending: 'Fetching and evaluating Nostr posts…',
      success: 'Evaluation completed. Refresh Nostr radar to see new content.',
      successOutput: 'appendText',
      statusTargetId: NR_FETCH_STATUS_TARGET_ID,
    },
  };
}

function fetchBucketTitle(bucket: FetchBucket): string {
  const since = new Date(bucket.since * 1000).toLocaleString();
  const until = new Date(bucket.until * 1000).toLocaleString();
  const fetchSince = new Date(bucket.fetchSince * 1000).toLocaleString();
  const fetchUntil = new Date(bucket.fetchUntil * 1000).toLocaleString();
  const range = `${since} → ${until}`;
  const fetchRange = `${fetchSince} → ${fetchUntil}`;

  if (bucket.status === 'unfetched') {
    return `Fetch follows for this interval: ${fetchRange}`;
  }

  return `${bucket.status}: ${bucket.eventCount} event(s). Coverage interval: ${range}. Click to fetch missing/latest slice: ${fetchRange}`;
}

export function fetchCoverageBar(alias: string, listData: NrListData): WebNode {
  const buckets = fetchBuckets(listData.fetchWindows);
  const labels = fetchBoundaryLabels();

  const node = el('stack', { id: 'nr-fetch-coverage', gap: 'xs' }, [
    el('row', { gap: 'xs', itemAlign: 'baseline', align: 'between' }, [
      el('text', { weight: 'semibold', size: 'sm' }, [text('Timeline bar')]),
      el('text', { tone: 'muted', size: 'sm' }, [
        text(
          `Backend ${listData.settings.backend ?? 'default'}, Model ${
            listData.settings.model ?? 'default'
          }`,
        ),
      ]),
    ]),
    el('box', { className: 'nr-fetch-coverage-bar' }, [
      el(
        'row',
        { className: 'nr-fetch-label-row' },
        labels.map((label) =>
          el('text', { className: 'nr-fetch-label' }, [text(label)]),
        ),
      ),
      el(
        'row',
        { className: 'nr-fetch-button-row' },
        buckets.map((bucket) =>
          el(
            'button',
            {
              label: fetchBucketTitle(bucket),
              className: `nr-fetch-bucket nr-fetch-bucket--${bucket.status}`,
              action: fetchBucketAction(alias, bucket),
            },
            [],
          ),
        ),
      ),
    ]),
    {
      ...(el(
        'treeItem',
        { id: 'nr-fetch-coverage-legend', defaultExpanded: false },
        [
          el('text', { size: 'sm' }, [text('Legend')]),
          el('text', { size: 'sm', whiteSpace: 'pre-wrap' }, [
            text(
              [
                'gray: not fetched yet',
                'green: fetched successfully',
                'yellow: partial fetch; some relay groups failed',
                'red: all relay groups failed',
              ].join('\n'),
            ),
          ]),
        ],
      ) as Extract<WebNode, { type: 'element' }>),
      renderKey: 'nr:timeline:fetch-coverage:legend',
    },
  ]);

  return node.type === 'element'
    ? { ...node, renderKey: 'nr:timeline:fetch-coverage' }
    : node;
}
