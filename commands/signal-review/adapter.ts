import {
  getNrSignalReviewTarget,
  getNrSignalReviewTargetAuthor,
  listNrDirectSignalReviewTopics,
} from '../../db';
import type { NrCommandAdapterParams } from '../../types/adapter-params';

import {
  renderSignalReviewRoot,
  type SignalReviewActionCategory,
} from './renderer/component';
import { verifiedSignalReviewTarget } from './target';

function stringOption(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stringArrayOption(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }

  return typeof value === 'string' && value.trim() ? [value.trim()] : [];
}

function normalizeTopic(topic: string): string {
  return topic.trim().toLowerCase();
}

function actionCategory(
  value: string | null,
): SignalReviewActionCategory | null {
  return value === 'archive' ||
    value === 'like' ||
    value === 'reply' ||
    value === 'repost_quote' ||
    value === 'local_like' ||
    value === 'local_dislike'
    ? value
    : null;
}

function createLabel(category: SignalReviewActionCategory): string {
  return {
    archive: 'Archive + create signal',
    like: 'Like + create signal',
    reply: 'Reply + create signal',
    repost_quote: 'Create signal',
    local_like: 'Create signal',
    local_dislike: 'Create signal',
  }[category];
}

function withoutSignalLabel(
  category: SignalReviewActionCategory,
): string | null {
  if (category === 'local_like' || category === 'local_dislike') {
    return null;
  }

  return {
    archive: 'Archive without signal',
    like: 'Like without signal',
    reply: 'Reply without signal',
    repost_quote: 'Without signal',
  }[category];
}

function rememberLabel(category: SignalReviewActionCategory): string {
  const action = {
    archive: 'Archive',
    like: 'Like',
    reply: 'Reply',
    repost_quote: 'Repost / Quote',
    local_like: 'Like',
    local_dislike: 'Dislike',
  }[category];

  return `Don't ask again for ${action}`;
}

function defaultSignalType(category: SignalReviewActionCategory): string {
  return category === 'repost_quote' ? 'repost' : category;
}

function listMode(value: unknown): string {
  return value === 'timeline' ||
    value === 'for-you' ||
    value === 'profile' ||
    value === 'archive'
    ? value
    : 'timeline';
}

function reviewedCommandSequence({
  alias,
  firstCommand,
  recordOptions,
  mergeFormOptionsIntoCommand,
  refreshCommand,
  successMutations,
}: {
  alias: string;
  firstCommand: Record<string, unknown> | null;
  recordOptions: Record<string, unknown>;
  mergeFormOptionsIntoCommand: number;
  refreshCommand: Record<string, unknown> | null;
  successMutations: Array<Record<string, unknown>>;
}) {
  const recordCommand = {
    command: alias,
    subcommand: 'signal-record',
    arguments: {},
    options: recordOptions,
    successTextPrefixes: ['Created ', 'Continued '],
  };

  return {
    type: 'clientAction' as const,
    action: 'web.commandSequence',
    payload: {
      commands: firstCommand ? [firstCommand, recordCommand] : [recordCommand],
      mergeFormOptionsIntoCommand,
      refreshCommand,
      successMutations,
    },
  };
}

export function adaptSignalReviewCommand(params: NrCommandAdapterParams) {
  void params.command;
  void params.identity;
  void params.agent;
  void params.sendReply;
  void params.storedCtx;
  void params.jsonPayload;

  if (params.source !== 'web') {
    return 'signal-review is only available from the web UI.';
  }

  const targetEventId = stringOption(params.parsed.options.target_event_id);

  const category = actionCategory(
    stringOption(params.parsed.options.action_category),
  );

  if (!targetEventId || !category) {
    return 'Missing signal review fields.';
  }

  const targetAuthorPubkey =
    getNrSignalReviewTargetAuthor({
      db: params.db,
      targetEventId,
    }) ??
    verifiedSignalReviewTarget(
      stringOption(params.parsed.options.target_event_json),
      targetEventId,
    )?.pubkey ??
    stringOption(params.parsed.options.target_author_pubkey)?.toLowerCase() ??
    null;

  const targetAuthorLabel =
    stringOption(params.parsed.options.target_author_label) ??
    targetAuthorPubkey?.slice(0, 12) ??
    'Target author';

  const dbCandidateTopics = listNrDirectSignalReviewTopics({
    db: params.db,
    targetEventId,
  });

  const candidateTopics =
    dbCandidateTopics.length > 0
      ? dbCandidateTopics
      : [
          ...new Set(
            stringArrayOption(params.parsed.options.candidate_topics)
              .map(normalizeTopic)
              .filter((topic) => topic.length > 0 && topic !== 'general'),
          ),
        ];

  const allowRemember =
    category !== 'local_like' && category !== 'local_dislike';

  const signalType = defaultSignalType(category);

  const recordOptions = {
    target_event_id: targetEventId,
    action_category: category,
    signal_type: signalType,
    target_author_pubkey: targetAuthorPubkey,
    candidate_topics: candidateTopics,
  };

  const target =
    getNrSignalReviewTarget({ db: params.db, targetEventId }) ??
    verifiedSignalReviewTarget(
      stringOption(params.parsed.options.target_event_json),
      targetEventId,
    );

  const refreshCommand = {
    command: params.alias,
    subcommand: 'list',
    arguments: {},
    options: { mode: listMode(params.parsed.options.list_mode) },
  };

  const signalReview = {
    actionCategory: category,
    targetAuthorPubkey,
    targetAuthorLabel,
    candidateTopics,
    allowRemember,
    rememberLabel: rememberLabel(category),
    mode: 'ask',
    targetEventJson: stringOption(params.parsed.options.target_event_json),
  };

  const archiveCommand =
    category === 'archive'
      ? {
          command: params.alias,
          subcommand: 'mark',
          arguments: { event_id: targetEventId },
          options: { archived: true },
        }
      : null;

  const createAction =
    category === 'archive'
      ? reviewedCommandSequence({
          alias: params.alias,
          firstCommand: archiveCommand,
          recordOptions,
          mergeFormOptionsIntoCommand: 1,
          refreshCommand,
          successMutations: [],
        })
      : category === 'local_like' || category === 'local_dislike'
        ? reviewedCommandSequence({
            alias: params.alias,
            firstCommand: null,
            recordOptions,
            mergeFormOptionsIntoCommand: 0,
            refreshCommand,
            successMutations: [
              {
                type: 'patchEntityActions',
                entityKey: `nostr-event:${targetEventId}`,
                actions: [
                  {
                    key: 'nr.localPreference.like',
                    label: category === 'local_like' ? '(👍)' : '👍',
                    active: category === 'local_like',
                  },
                  {
                    key: 'nr.localPreference.dislike',
                    label: category === 'local_dislike' ? '(👎)' : '👎',
                    active: category === 'local_dislike',
                  },
                ],
              },
            ],
          })
        : category === 'like' && target
          ? {
              type: 'clientAction' as const,
              action: 'nostr.likeEvent',
              payload: {
                eventId: target.id,
                eventPubkey: target.pubkey,
                eventKind: target.kind,
                nrAlias: params.alias,
                relayHints: target.relayHints,
                signalReview,
              },
            }
          : {
              type: 'command' as const,
              command: params.alias,
              subcommand: 'signal-record',
              arguments: {},
              options: recordOptions,
              surface: 'modal' as const,
              modalTitle: 'Nostr Radar signal review',
              recordInTimeline: false,
            };

  const withoutSignalAction =
    category === 'archive'
      ? reviewedCommandSequence({
          alias: params.alias,
          firstCommand: archiveCommand,
          recordOptions,
          mergeFormOptionsIntoCommand: 1,
          refreshCommand,
          successMutations: [],
        })
      : category === 'like'
        ? createAction
        : {
            type: 'command' as const,
            command: params.alias,
            subcommand: 'signal-record',
            arguments: {},
            options: recordOptions,
            surface: 'modal' as const,
            modalTitle: 'Nostr Radar signal review',
            recordInTimeline: false,
          };

  return renderSignalReviewRoot({
    title: 'Creating a signal for this post',
    targetAuthorPubkey,
    targetAuthorLabel,
    candidateTopics,
    allowRemember,
    rememberLabel: rememberLabel(category),
    createLabel: createLabel(category),
    withoutSignalLabel: withoutSignalLabel(category),
    createAction,
    withoutSignalAction,
    cancelAction: {
      type: 'clientAction',
      action: 'web.closeModal',
      payload: {},
    },
    formOptionFieldNames: [
      'signal_topics',
      'signal_author_pubkey',
      'signal_remember',
    ],
  });
}
