import { setNrLocalPreference } from '../../db';
import type { NrCommandAdapterParams } from '../../types/adapter-params';

export function adaptInterestRecordCommand(
  params: NrCommandAdapterParams,
): string {
  const targetEventId = params.parsed.options.target_event_id;
  const preference = params.parsed.options.preference;

  if (
    typeof targetEventId !== 'string' ||
    !targetEventId.trim() ||
    (preference !== 'like' && preference !== 'dislike' && preference !== 'none')
  ) {
    return 'Missing private interest signal fields.';
  }

  setNrLocalPreference({
    db: params.db,
    targetEventId: targetEventId.trim(),
    preference,
  });

  return `Set local preference ${preference}: ${targetEventId.trim()}`;
}
