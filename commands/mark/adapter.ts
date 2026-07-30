import { classifyEvent } from '../../classifier';
import {
  markEventState,
  markTaggedEventsState,
  parseAndStoreEvent,
  recordNrInterestSignal,
  type NrMarkState,
} from '../../db';
import type { NrCommandAdapterParams } from '../../types/adapter-params';

import { NostrEventSchema } from '../shared/types';

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 'true';
}

function readType(value: unknown): 'topic' | 'mood' | null {
  const text = stringValue(value);

  return text === 'topic' || text === 'mood' ? text : null;
}

function selectedState(options: Record<string, unknown>): NrMarkState | null {
  const states: NrMarkState[] = [];

  if (booleanValue(options.read)) {
    states.push('read');
  }

  if (booleanValue(options.unread)) {
    states.push('unread');
  }

  if (booleanValue(options.archived)) {
    states.push('archived');
  }

  if (booleanValue(options.unarchived)) {
    states.push('unarchived');
  }

  return states.length === 1 ? states[0] : null;
}

function usage(prefix: string, alias: string): string {
  return `Usage: ${prefix}${alias} mark <event_id> --read|--unread|--archived|--unarchived OR ${prefix}${alias} mark --type <topic|mood> --tag <tag> --read|--unread|--archived|--unarchived`;
}

function parseEventJson(value: unknown) {
  const raw = stringValue(value);

  if (!raw) {
    return null;
  }

  return NostrEventSchema.parse(JSON.parse(raw));
}

export async function adaptMarkCommand(
  params: NrCommandAdapterParams,
): Promise<string> {
  void params.command;
  void params.source;
  void params.identity;
  void params.runAgent;

  const positionalEventId = stringValue(params.parsed.arguments.event_id);
  const optionEventId = stringValue(params.parsed.options.id);
  const type = readType(params.parsed.options.type);
  const tag = stringValue(params.parsed.options.tag);
  const eventId = optionEventId ?? positionalEventId;
  const state = selectedState(params.parsed.options);

  if (!state) {
    return `Choose exactly one mark flag. ${usage(params.prefix, params.alias)}`;
  }

  if (eventId && (type || tag)) {
    return usage(params.prefix, params.alias);
  }

  if ((type && !tag) || (!type && tag)) {
    return usage(params.prefix, params.alias);
  }

  if (type && tag) {
    const result = markTaggedEventsState({
      db: params.db,
      type,
      tag,
      state,
    });

    return `Marked ${result.type} ${state}: ${result.tag} (${result.eventCount} event${result.eventCount === 1 ? '' : 's'})`;
  }

  if (!eventId) {
    return usage(params.prefix, params.alias);
  }

  const markEvent = () =>
    markEventState({
      db: params.db,
      eventId,
      state,
    });

  let event =
    state === 'read' && params.storedCtx.monitoring.currentContext()
      ? await params.storedCtx.monitoring.withSpan({
          name: 'nr.read.db',
          attributes: { eventId },
          parent: null,
          run: markEvent,
        })
      : markEvent();

  if (!event) {
    const rawEvent = parseEventJson(params.parsed.options.event_json);

    if (rawEvent?.id === eventId) {
      await parseAndStoreEvent({
        db: params.db,
        event: rawEvent,
        forceReclassify: false,
        relayHints: [],
        threadContext: [],
        referencedEvents: [],
        nostrResolution: params.storedCtx.nostrResolution,
        classify: classifyEvent,
      });

      event = markEventState({
        db: params.db,
        eventId,
        state,
      });
    }
  }

  if (!event) {
    return `Not found: ${eventId}`;
  }

  if (state === 'archived') {
    recordNrInterestSignal({
      db: params.db,
      targetEventId: eventId,
      type: 'archive',
      createdAt: Date.now(),
      topics: null,
      moods: null,
      source: 'archive',
    });
  }

  return `Marked ${state}: ${event.id}`;
}
