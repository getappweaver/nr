import { markEventRead, markTaggedEventsRead } from '../../db';
import type { NrCommandAdapterParams } from '../../types/adapter-params';

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readType(value: unknown): 'topic' | 'mood' | null {
  const text = stringValue(value);

  return text === 'topic' || text === 'mood' ? text : null;
}

export function adaptReadCommand(params: NrCommandAdapterParams): string {
  void params.command;
  void params.source;
  void params.identity;
  void params.runAgent;

  const positionalEventId = stringValue(params.parsed.arguments.event_id);
  const optionEventId = stringValue(params.parsed.options.id);
  const type = readType(params.parsed.options.type);
  const tag = stringValue(params.parsed.options.tag);
  const eventId = optionEventId ?? positionalEventId;

  if (eventId && (type || tag)) {
    return `Usage: ${params.prefix}${params.alias} read <event_id> OR ${params.prefix}${params.alias} read --type <topic|mood> --tag <tag>`;
  }

  if ((type && !tag) || (!type && tag)) {
    return `Usage: ${params.prefix}${params.alias} read --type <topic|mood> --tag <tag>`;
  }

  if (type && tag) {
    const result = markTaggedEventsRead({
      db: params.db,
      type,
      tag,
    });

    return `Marked ${result.type} read: ${result.tag} (${result.eventCount} event${result.eventCount === 1 ? '' : 's'})`;
  }

  if (!eventId) {
    return `Usage: ${params.prefix}${params.alias} read <event_id> OR ${params.prefix}${params.alias} read --type <topic|mood> --tag <tag>`;
  }

  const event = markEventRead(params.db, eventId);

  if (!event) {
    return `Not found: ${eventId}`;
  }

  return `Marked read: ${event.id}`;
}
