import type { NrListMode, NrListTimeRange } from '../shared/types';

type NrListCommandOptionsProps = {
  mode: NrListMode;
  selectedTimeRanges: NrListTimeRange[];
};

type NrListCommandActionProps = NrListCommandOptionsProps & {
  alias: string;
};

export function encodeNrListTimeRange(range: NrListTimeRange): string {
  return `${range.since}:${range.until}`;
}

export function nrListTimeRangeKey(range: NrListTimeRange): string {
  return `hour:${range.since}:${range.until}`;
}

export function nrListCommandOptions({
  mode,
  selectedTimeRanges,
}: NrListCommandOptionsProps): Record<string, unknown> {
  return {
    mode,
    time_filter_initialized: true,
    ...(selectedTimeRanges.length > 0
      ? { time_range: selectedTimeRanges.map(encodeNrListTimeRange) }
      : {}),
  };
}

export function nrListCommandAction({
  alias,
  mode,
  selectedTimeRanges,
}: NrListCommandActionProps) {
  return {
    type: 'command' as const,
    command: alias,
    subcommand: 'list',
    arguments: {},
    options: nrListCommandOptions({ mode, selectedTimeRanges }),
    recordInTimeline: false,
  };
}
