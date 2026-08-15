import type { NrFetchStatus, NrFetchWindow } from '../shared/types';

export type NrFetchCoverageBucket = {
  since: number;
  until: number;
  fetchSince: number;
  fetchUntil: number;
  status: NrFetchStatus | 'unfetched';
  eventCount: number;
};

type Interval = {
  since: number;
  until: number;
};

type CalculateNrFetchCoverageProps = {
  fetchWindows: NrFetchWindow[];
  nowSeconds: number;
  hours: number;
};

type CalculateNrFetchCoverageBucketsProps = {
  fetchWindows: NrFetchWindow[];
  nowSeconds: number;
  bucketStarts: number[];
};

const HOUR_SECONDS = 60 * 60;

function hourStart(timestampSeconds: number): number {
  return Math.floor(timestampSeconds / HOUR_SECONDS) * HOUR_SECONDS;
}

function clampIntervalToBucket({
  window,
  bucket,
}: {
  window: NrFetchWindow;
  bucket: NrFetchCoverageBucket;
}): Interval | null {
  const since = Math.max(window.since, bucket.since);
  const until = Math.min(window.until, bucket.until);

  return until > since ? { since, until } : null;
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((left, right) => left.since - right.since);
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

function latestCoveredUntil({
  fetchWindows,
  bucket,
}: {
  fetchWindows: NrFetchWindow[];
  bucket: NrFetchCoverageBucket;
}): number | null {
  const firstInterval = mergeIntervals(
    fetchWindows
      .filter((window) => window.status !== 'failed')
      .map((window) => clampIntervalToBucket({ window, bucket }))
      .filter((interval): interval is Interval => interval !== null),
  ).find((interval) => interval.since <= bucket.since);

  return firstInterval?.until ?? null;
}

function bucketStatus({
  fetchWindows,
  bucket,
}: {
  fetchWindows: NrFetchWindow[];
  bucket: NrFetchCoverageBucket;
}): Pick<NrFetchCoverageBucket, 'status' | 'eventCount'> {
  const overlaps = fetchWindows.filter(
    (window) => window.until > bucket.since && window.since < bucket.until,
  );

  if (overlaps.length === 0) {
    return { status: 'unfetched', eventCount: 0 };
  }

  const eventCount = overlaps.reduce(
    (total, window) => total + window.eventCount,
    0,
  );

  const successfulIntervals = mergeIntervals(
    overlaps
      .filter((window) => window.status === 'fetched')
      .map((window) => clampIntervalToBucket({ window, bucket }))
      .filter((interval): interval is Interval => interval !== null),
  );

  const fullyFetched = successfulIntervals.some(
    (interval) =>
      interval.since <= bucket.since && interval.until >= bucket.until,
  );

  const hasPartial = overlaps.some((window) => window.status === 'partial');
  const hasSuccessful = overlaps.some((window) => window.status !== 'failed');

  if (!hasSuccessful) {
    return { status: 'failed', eventCount };
  }

  if (hasPartial || !fullyFetched) {
    return { status: 'partial', eventCount };
  }

  return { status: 'fetched', eventCount };
}

export function calculateNrFetchCoverage({
  fetchWindows,
  nowSeconds,
  hours,
}: CalculateNrFetchCoverageProps): NrFetchCoverageBucket[] {
  const currentHourStart = hourStart(nowSeconds);

  return calculateNrFetchCoverageBuckets({
    fetchWindows,
    nowSeconds,
    bucketStarts: Array.from(
      { length: hours },
      (_, index) => currentHourStart - index * HOUR_SECONDS,
    ),
  });
}

export function calculateNrFetchCoverageBuckets({
  fetchWindows,
  nowSeconds,
  bucketStarts,
}: CalculateNrFetchCoverageBucketsProps): NrFetchCoverageBucket[] {
  const currentHourStart = hourStart(nowSeconds);

  return bucketStarts.map((since) => {
    const isCurrentHour = since === currentHourStart;

    const fetchUntil = isCurrentHour
      ? Math.max(nowSeconds, since + 1)
      : since + HOUR_SECONDS;

    const bucket: NrFetchCoverageBucket = {
      since,
      until: since + HOUR_SECONDS,
      fetchSince: since,
      fetchUntil,
      status: 'unfetched',
      eventCount: 0,
    };

    const coveredUntil = latestCoveredUntil({ fetchWindows, bucket });

    return {
      ...bucket,
      fetchSince:
        coveredUntil && coveredUntil < fetchUntil ? coveredUntil : since,
      ...bucketStatus({ fetchWindows, bucket }),
    };
  });
}

export function newestFetchedNrCoverageBucket(
  buckets: NrFetchCoverageBucket[],
): NrFetchCoverageBucket | null {
  return (
    buckets.find(
      (bucket) => bucket.status === 'fetched' || bucket.status === 'partial',
    ) ?? null
  );
}
