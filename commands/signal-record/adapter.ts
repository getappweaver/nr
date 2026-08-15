import {
  getNrSignalReviewTargetAuthor,
  listNrDirectSignalReviewTopics,
  recordReviewedNrInterestSignal,
  removeNrInterestSignal,
} from '../../db';
import {
  saveNrSignalReviewMode,
  type NrSignalReviewMode,
} from '../../settings';
import type { NrCommandAdapterParams } from '../../types/adapter-params';

import type { NrInterestSignal, NrInterestSignalType } from '../shared/types';
import type { SignalReviewActionCategory } from '../signal-review/renderer/component';
import { verifiedSignalReviewTarget } from '../signal-review/target';

function stringOption(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stringArrayOption(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }

  return typeof value === 'string' && value.trim() ? [value.trim()] : [];
}

function booleanOption(value: unknown): boolean {
  return value === true || value === 'true' || value === '1';
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

function signalType(value: string | null): NrInterestSignalType | null {
  return value === 'like' ||
    value === 'reply' ||
    value === 'repost' ||
    value === 'quote' ||
    value === 'archive' ||
    value === 'local_like' ||
    value === 'local_dislike'
    ? value
    : null;
}

function defaultSignalType(
  category: SignalReviewActionCategory,
): NrInterestSignalType {
  return category === 'repost_quote' ? 'repost' : category;
}

function signalSource(type: NrInterestSignalType): NrInterestSignal['source'] {
  if (type === 'archive') {
    return 'archive';
  }

  if (type === 'local_like' || type === 'local_dislike') {
    return 'private';
  }

  return 'interaction';
}

function settingsCategory(
  category: SignalReviewActionCategory,
): 'archive' | 'like' | 'reply' | 'repost_quote' | null {
  return category === 'local_like' || category === 'local_dislike'
    ? null
    : category;
}

function modeForOutcome(outcome: string): NrSignalReviewMode | null {
  if (outcome === 'create') {
    return 'always';
  }

  if (outcome === 'without_signal') {
    return 'never';
  }

  return null;
}

function normalizeTopic(topic: string): string {
  return topic.trim().toLowerCase();
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function adaptSignalRecordCommand(
  params: NrCommandAdapterParams,
): string {
  void params.command;
  void params.identity;
  void params.runAgent;
  void params.sendReply;
  void params.storedCtx;
  void params.jsonPayload;

  if (params.source !== 'web') {
    return 'signal-record is only available from the web UI.';
  }

  const targetEventId = stringOption(params.parsed.options.target_event_id);

  const category = actionCategory(
    stringOption(params.parsed.options.action_category),
  );

  const outcome = stringOption(params.parsed.options.signal_outcome);

  if (!targetEventId || !category || !outcome) {
    return 'Missing signal record fields.';
  }

  if (outcome !== 'create' && outcome !== 'without_signal') {
    return 'Invalid signal outcome.';
  }

  const type =
    signalType(stringOption(params.parsed.options.signal_type)) ??
    defaultSignalType(category);

  const remember = booleanOption(params.parsed.options.signal_remember);

  return params.db.transaction(() => {
    if (outcome === 'create') {
      const targetAuthorPubkey =
        getNrSignalReviewTargetAuthor({
          db: params.db,
          targetEventId,
        }) ??
        verifiedSignalReviewTarget(
          stringOption(params.parsed.options.target_event_json),
          targetEventId,
        )?.pubkey ??
        stringOption(
          params.parsed.options.target_author_pubkey,
        )?.toLowerCase() ??
        null;

      const selectedAuthor = stringOption(
        params.parsed.options.signal_author_pubkey,
      )?.toLowerCase();

      if (selectedAuthor && selectedAuthor !== targetAuthorPubkey) {
        throw new Error('Selected signal author is not the target author.');
      }

      const dbAllowedTopics = listNrDirectSignalReviewTopics({
        db: params.db,
        targetEventId,
      });

      const allowedTopics = new Set(
        dbAllowedTopics.length > 0
          ? dbAllowedTopics
          : stringArrayOption(params.parsed.options.candidate_topics).map(
              normalizeTopic,
            ),
      );

      const selectedTopics = [
        ...new Set(
          stringArrayOption(params.parsed.options.signal_topics)
            .map(normalizeTopic)
            .filter((topic) => topic.length > 0 && topic !== 'general'),
        ),
      ];

      if (selectedTopics.length > 32) {
        throw new Error('A signal can include at most 32 topics.');
      }

      if (utf8ByteLength(JSON.stringify(selectedTopics)) > 4096) {
        throw new Error('Selected signal topics are too large.');
      }

      for (const topic of selectedTopics) {
        if (utf8ByteLength(topic) > 128) {
          throw new Error(`Selected signal topic is too large: ${topic}`);
        }

        if (!allowedTopics.has(topic)) {
          throw new Error(`Selected signal topic is stale: ${topic}`);
        }
      }

      if (type === 'local_like' || type === 'local_dislike') {
        removeNrInterestSignal({
          db: params.db,
          targetEventId,
          type: type === 'local_like' ? 'local_dislike' : 'local_like',
        });
      }

      recordReviewedNrInterestSignal({
        db: params.db,
        targetEventId,
        type,
        createdAt: Date.now(),
        topics: selectedTopics,
        authorPubkey: selectedAuthor ?? null,
        source: signalSource(type),
      });
    }

    const reviewSettingsCategory = settingsCategory(category);
    const reviewMode = modeForOutcome(outcome);

    if (remember && reviewSettingsCategory && reviewMode) {
      saveNrSignalReviewMode({
        db: params.db,
        category: reviewSettingsCategory,
        mode: reviewMode,
      });
    }

    return outcome === 'create'
      ? `Created ${type} signal: ${targetEventId}`
      : `Continued without creating a signal: ${targetEventId}`;
  })();
}
