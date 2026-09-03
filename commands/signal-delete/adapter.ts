import { deleteNrAuthorSignals, deleteNrTopicSignals } from '../../db';
import type { NrCommandAdapterParams } from '../../types/adapter-params';

function stringOption(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function adaptSignalDeleteCommand(
  params: NrCommandAdapterParams,
): string {
  void params.command;
  void params.identity;
  void params.agent;
  void params.sendReply;
  void params.storedCtx;
  void params.jsonPayload;

  const topic = stringOption(params.parsed.options.topic);
  const authorPubkey = stringOption(params.parsed.options.author_pubkey);

  if ((topic === null) === (authorPubkey === null)) {
    return 'Pass exactly one of --topic or --author-pubkey.';
  }

  if (topic !== null) {
    const deleted = deleteNrTopicSignals({ db: params.db, topic });

    return `Deleted ${deleted} signal${deleted === 1 ? '' : 's'} for topic "${topic.toLowerCase()}".`;
  }

  const deleted = deleteNrAuthorSignals({
    db: params.db,
    authorPubkey: authorPubkey ?? '',
  });

  return `Deleted ${deleted} signal${deleted === 1 ? '' : 's'} for author ${(authorPubkey ?? '').slice(0, 12)}.`;
}
