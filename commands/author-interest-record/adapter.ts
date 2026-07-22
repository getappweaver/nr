import { setNrAuthorPreference } from '../../db';
import type { NrCommandAdapterParams } from '../../types/adapter-params';

export function adaptAuthorInterestRecordCommand(
  params: NrCommandAdapterParams,
): string {
  const pubkey = params.parsed.options.pubkey;
  const preference = params.parsed.options.preference;

  if (
    typeof pubkey !== 'string' ||
    !pubkey.trim() ||
    (preference !== 'like' && preference !== 'dislike' && preference !== 'none')
  ) {
    return 'Missing private author preference fields.';
  }

  setNrAuthorPreference({
    db: params.db,
    pubkey: pubkey.trim(),
    preference,
  });

  return `Set author preference ${preference}: ${pubkey.trim()}`;
}
