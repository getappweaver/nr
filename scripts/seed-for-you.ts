import { SimplePool } from 'nostr-tools/pool';

import {
  fetchNip65WriteRelays,
  PROFILE_RELAYS_FOR_QUERY,
  uniqueRelays,
} from '../../../src/nostr/nip65';

import { classifyEvent } from '../classifier';
import {
  NostrEventSchema,
  type NostrEvent,
  type NrEvent,
  type NrInterestSignal,
  type NrInterestSignalType,
} from '../commands/shared/types';
import {
  buildNrTopicAffinities,
  clearSeededNrInterestSignals,
  getNr,
  getNrListData,
  listNrInterestSignals,
  openDb,
  recordNrInterestSignal,
  scoreNrEventForYou,
} from '../db';

type ScriptOptions = {
  apply: boolean;
  clear: boolean;
  fromProfile: boolean;
  limit: number;
};

type ProfileInteraction = {
  event: NostrEvent;
  signalType: Extract<
    NrInterestSignalType,
    'like' | 'reply' | 'repost' | 'quote'
  >;
  targetEventId: string;
  relayHints: string[];
  embeddedTarget: NostrEvent | null;
};

type PlannedSignal = {
  targetEventId: string;
  type: ProfileInteraction['signalType'];
  topics: string[];
  moods: string[];
  createdAt: number;
  classificationSource: 'existing' | 'heuristic';
};

const PROFILE_FETCH_PAGE_SIZE = 100;
const MAX_PROFILE_FETCH_PAGES = 20;
const PREVIEW_LIMIT = 10;

function parsePositiveInteger(value: string | undefined, flag: string): number {
  const parsed = Number.parseInt(value ?? '', 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} requires a positive integer.`);
  }

  return parsed;
}

function parseOptions(args: string[]): ScriptOptions {
  let apply = false;
  let clear = false;
  let fromProfile = false;
  let limit = 100;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--apply') {
      apply = true;
    } else if (arg === '--clear') {
      clear = true;
    } else if (arg === '--from-profile') {
      fromProfile = true;
    } else if (arg === '--limit') {
      limit = parsePositiveInteger(args[index + 1], '--limit');
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!clear && !fromProfile) {
    throw new Error('Use --from-profile to preview or apply Profile seeds.');
  }

  return { apply, clear, fromProfile, limit };
}

function tagReference(
  event: NostrEvent,
  tagName: 'e' | 'q',
): { id: string; relayHints: string[] } | null {
  const tags = event.tags.filter(
    (tag) => tag[0] === tagName && typeof tag[1] === 'string' && tag[1],
  );

  const preferred =
    tags.find((tag) => tag[3] === 'reply') ??
    tags.find((tag) => tag[3] === 'root') ??
    tags.at(-1);

  if (!preferred?.[1]) {
    return null;
  }

  return {
    id: preferred[1],
    relayHints: preferred[2] ? [preferred[2]] : [],
  };
}

function embeddedRepost(event: NostrEvent): NostrEvent | null {
  if (event.kind !== 6) {
    return null;
  }

  try {
    const parsed = NostrEventSchema.safeParse(JSON.parse(event.content));

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function profileInteraction(event: NostrEvent): ProfileInteraction | null {
  if (event.kind === 7) {
    const target = tagReference(event, 'e');

    return target
      ? {
          event,
          signalType: 'like',
          targetEventId: target.id,
          relayHints: target.relayHints,
          embeddedTarget: null,
        }
      : null;
  }

  if (event.kind === 6 || event.kind === 16) {
    const embeddedTarget = embeddedRepost(event);
    const target = tagReference(event, 'e');
    const targetEventId = target?.id ?? embeddedTarget?.id;

    return targetEventId
      ? {
          event,
          signalType: 'repost',
          targetEventId,
          relayHints: target?.relayHints ?? [],
          embeddedTarget,
        }
      : null;
  }

  if (event.kind === 1) {
    const quote = tagReference(event, 'q');

    if (quote) {
      return {
        event,
        signalType: 'quote',
        targetEventId: quote.id,
        relayHints: quote.relayHints,
        embeddedTarget: null,
      };
    }

    const reply = tagReference(event, 'e');

    return reply
      ? {
          event,
          signalType: 'reply',
          targetEventId: reply.id,
          relayHints: reply.relayHints,
          embeddedTarget: null,
        }
      : null;
  }

  return null;
}

async function fetchProfileInteractions({
  pool,
  relays,
  pubkey,
  limit,
}: {
  pool: SimplePool;
  relays: string[];
  pubkey: string;
  limit: number;
}): Promise<ProfileInteraction[]> {
  const interactions = new Map<string, ProfileInteraction>();
  let until = Math.floor(Date.now() / 1000);

  for (
    let pageIndex = 0;
    pageIndex < MAX_PROFILE_FETCH_PAGES && interactions.size < limit;
    pageIndex += 1
  ) {
    const page = await pool.querySync(
      relays,
      {
        authors: [pubkey],
        kinds: [1, 6, 7, 16],
        until,
        limit: PROFILE_FETCH_PAGE_SIZE,
      },
      { maxWait: 10_000 },
    );

    const events = page
      .map((event) => NostrEventSchema.safeParse(event))
      .filter((result) => result.success)
      .map((result) => result.data)
      .sort((left, right) => right.created_at - left.created_at);

    for (const event of events) {
      const interaction = profileInteraction(event);

      if (interaction) {
        interactions.set(event.id, interaction);
      }

      if (interactions.size >= limit) {
        break;
      }
    }

    const oldest = events.at(-1);

    if (events.length < PROFILE_FETCH_PAGE_SIZE || !oldest) {
      break;
    }

    until = oldest.created_at - 1;
  }

  return [...interactions.values()]
    .sort((left, right) => right.event.created_at - left.event.created_at)
    .slice(0, limit);
}

async function fetchMissingTargets({
  pool,
  relays,
  interactions,
  existingTargetIds,
}: {
  pool: SimplePool;
  relays: string[];
  interactions: ProfileInteraction[];
  existingTargetIds: Set<string>;
}): Promise<Map<string, NostrEvent>> {
  const embeddedTargets = interactions.flatMap((interaction) =>
    interaction.embeddedTarget ? [interaction.embeddedTarget] : [],
  );

  const targets = new Map(embeddedTargets.map((event) => [event.id, event]));

  const missingIds = [
    ...new Set(
      interactions
        .map((interaction) => interaction.targetEventId)
        .filter((id) => !existingTargetIds.has(id) && !targets.has(id)),
    ),
  ];

  if (missingIds.length === 0) {
    return targets;
  }

  const targetRelays = uniqueRelays([
    ...relays,
    ...PROFILE_RELAYS_FOR_QUERY,
    ...interactions.flatMap((interaction) => interaction.relayHints),
  ]);

  const fetched = await pool.querySync(
    targetRelays,
    { ids: missingIds, limit: missingIds.length },
    { maxWait: 10_000 },
  );

  for (const rawEvent of fetched) {
    const parsed = NostrEventSchema.safeParse(rawEvent);

    if (parsed.success) {
      targets.set(parsed.data.id, parsed.data);
    }
  }

  return targets;
}

function plannedSignals({
  interactions,
  fetchedTargets,
  existingSignals,
  getExistingEvent,
}: {
  interactions: ProfileInteraction[];
  fetchedTargets: Map<string, NostrEvent>;
  existingSignals: NrInterestSignal[];
  getExistingEvent: (id: string) => NrEvent | null;
}): { signals: PlannedSignal[]; missingTargets: number; conflicts: number } {
  const existingKeys = new Set(
    existingSignals.map((signal) => `${signal.targetEventId}:${signal.type}`),
  );

  const plannedKeys = new Set<string>();
  const signals: PlannedSignal[] = [];
  let missingTargets = 0;
  let conflicts = 0;

  for (const interaction of interactions) {
    const key = `${interaction.targetEventId}:${interaction.signalType}`;

    if (existingKeys.has(key) || plannedKeys.has(key)) {
      conflicts += 1;
      continue;
    }

    const existingEvent = getExistingEvent(interaction.targetEventId);
    const fetchedTarget = fetchedTargets.get(interaction.targetEventId);

    if (!existingEvent && !fetchedTarget) {
      missingTargets += 1;
      continue;
    }

    const classification = existingEvent ?? classifyEvent(fetchedTarget!);
    plannedKeys.add(key);

    signals.push({
      targetEventId: interaction.targetEventId,
      type: interaction.signalType,
      topics: classification.topics,
      moods: classification.moods,
      createdAt: interaction.event.created_at * 1000,
      classificationSource: existingEvent ? 'existing' : 'heuristic',
    });
  }

  return { signals, missingTargets, conflicts };
}

function asInterestSignal(signal: PlannedSignal): NrInterestSignal {
  const weight = {
    like: 1,
    reply: 2,
    repost: 3,
    quote: 2,
  }[signal.type];

  return {
    targetEventId: signal.targetEventId,
    type: signal.type,
    weight,
    topics: signal.topics,
    moods: signal.moods,
    source: 'seed',
    createdAt: signal.createdAt,
    updatedAt: signal.createdAt,
  };
}

function printRanking(
  label: string,
  events: NrEvent[],
  signals: NrInterestSignal[],
): void {
  const topicAffinities = buildNrTopicAffinities(signals);

  const ranked = [...events]
    .sort((left, right) => {
      const scoreDifference =
        scoreNrEventForYou(right, topicAffinities) -
        scoreNrEventForYou(left, topicAffinities);

      return scoreDifference || right.event_created_at - left.event_created_at;
    })
    .slice(0, PREVIEW_LIMIT);

  console.log(`\n${label}`);

  for (const [index, event] of ranked.entries()) {
    const score = scoreNrEventForYou(event, topicAffinities).toFixed(2);
    const tags = [...event.topics, ...event.moods].join(', ') || '(no tags)';

    const summary = (event.summary || event.content)
      .replace(/\s+/g, ' ')
      .slice(0, 80);

    console.log(`${index + 1}. ${score}  ${tags}  ${summary}`);
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const db = openDb();

  try {
    if (options.clear) {
      const count = options.apply ? clearSeededNrInterestSignals(db) : 0;

      const existingSeedCount = listNrInterestSignals(db).filter(
        (signal) => signal.source === 'seed',
      ).length;

      console.log(
        options.apply
          ? `Removed ${count} seeded signal${count === 1 ? '' : 's'}.`
          : `Dry run: would remove ${existingSeedCount} seeded signal${existingSeedCount === 1 ? '' : 's'}. Add --apply to continue.`,
      );

      return;
    }

    const pubkey = process.env.BOT_MASTER_PUBKEY?.trim();

    if (!pubkey || !/^[0-9a-f]{64}$/i.test(pubkey)) {
      throw new Error('BOT_MASTER_PUBKEY must be a 64-character hex pubkey.');
    }

    const pool = new SimplePool();
    let relays: string[] = [];
    let closeRelays = [...PROFILE_RELAYS_FOR_QUERY];

    try {
      relays = await fetchNip65WriteRelays({ pool, authorPubkey: pubkey });
      closeRelays = uniqueRelays([...closeRelays, ...relays]);

      const interactions = await fetchProfileInteractions({
        pool,
        relays,
        pubkey,
        limit: options.limit,
      });

      closeRelays = uniqueRelays([
        ...closeRelays,
        ...interactions.flatMap((interaction) => interaction.relayHints),
      ]);

      const existingSignals = listNrInterestSignals(db);
      const existingEvents = new Map<string, NrEvent>();

      for (const interaction of interactions) {
        const event = getNr(db, interaction.targetEventId);

        if (event) {
          existingEvents.set(event.id, event);
        }
      }

      const fetchedTargets = await fetchMissingTargets({
        pool,
        relays,
        interactions,
        existingTargetIds: new Set(existingEvents.keys()),
      });

      const planned = plannedSignals({
        interactions,
        fetchedTargets,
        existingSignals,
        getExistingEvent: (id) => existingEvents.get(id) ?? null,
      });

      const heuristicCount = planned.signals.filter(
        (signal) => signal.classificationSource === 'heuristic',
      ).length;

      const listData = getNrListData({ db, mode: 'for-you' });

      const projectedSignals = [
        ...existingSignals,
        ...planned.signals.map(asInterestSignal),
      ];

      console.log(`Profile relays: ${relays.join(', ')}`);
      console.log(`Qualifying interactions: ${interactions.length}`);
      console.log(`Signals to create: ${planned.signals.length}`);

      console.log(
        `Existing classifications reused: ${planned.signals.length - heuristicCount}`,
      );

      console.log(`Heuristic classifications: ${heuristicCount}`);
      console.log(`Missing targets: ${planned.missingTargets}`);

      console.log(
        `Existing or duplicate signals skipped: ${planned.conflicts}`,
      );

      printRanking('Current For You', listData.forYouEvents, existingSignals);

      printRanking(
        'Projected For You',
        listData.forYouEvents,
        projectedSignals,
      );

      if (!options.apply) {
        console.log(
          '\nDry run only. Add --apply to create the seeded signals.',
        );

        return;
      }

      for (const signal of planned.signals) {
        recordNrInterestSignal({
          db,
          targetEventId: signal.targetEventId,
          type: signal.type,
          createdAt: signal.createdAt,
          topics: signal.topics,
          moods: signal.moods,
          source: 'seed',
        });
      }

      console.log(
        `\nCreated ${planned.signals.length} seeded signal${planned.signals.length === 1 ? '' : 's'}.`,
      );
    } finally {
      pool.close(closeRelays);
    }
  } finally {
    db.close();
  }
}

await main();
