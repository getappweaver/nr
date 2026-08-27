import { SchedulerV1 } from '@src/capabilities/scheduler.v1';
import type { CapabilityResourceRef } from '@src/capabilities/types';
import type { AgentBackendName } from '@src/db';
import type { WebNode, WebNodeRoot } from '@src/web/ui-schema';

import {
  getNrSchedulerResource,
  getNrSettings,
  resetNrSettings,
  saveNrSchedulerResource,
  type NrSignalReviewMode,
  saveNrSettings,
} from '../../settings';
import type { NrCommandAdapterParams } from '../../types/adapter-params';

import { NR_HOURLY_SCHEDULER_INPUT } from '../schedule/adapter';

function text(value: string): WebNode {
  return { type: 'text', value };
}

function el(
  tag: Extract<WebNode, { type: 'element' }>['tag'],
  props: Record<string, unknown>,
  children: WebNode[],
): WebNode {
  return { type: 'element', tag, props, children } as WebNode;
}

function asOptionalStringOverride(value: unknown): string | null | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  return value.trim() === '' ? null : value;
}

function parseBooleanOption(value: unknown): boolean {
  return value === true || value === 'true' || value === '1';
}

function parseEnabledSetting(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (value === true || value === 'true' || value === 'enabled') {
    return true;
  }

  if (value === false || value === 'false' || value === 'disabled') {
    return false;
  }

  throw new Error('Initial latest-hour filter must be enabled or disabled.');
}

function parseBackend(value: unknown): AgentBackendName | null | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (value === '' || value === 'default') {
    return null;
  }

  if (value === 'cursor' || value === 'opencode') {
    return value;
  }

  throw new Error('backend must be cursor or opencode');
}

function parseSignalReviewMode(
  value: unknown,
  label: string,
): NrSignalReviewMode | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (value === 'ask' || value === 'always' || value === 'never') {
    return value;
  }

  throw new Error(`${label} must be ask, always, or never.`);
}

function parsePositiveInteger(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed =
    typeof value === 'number' ? value : Number.parseInt(String(value), 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('Relay fetch concurrency must be a positive integer.');
  }

  return parsed;
}

const SIGNAL_REVIEW_MODE_CHOICES: NrSignalReviewMode[] = [
  'ask',
  'always',
  'never',
];

const SIGNAL_REVIEW_MODE_LABELS: Record<NrSignalReviewMode, string> = {
  ask: 'Ask every time',
  always: 'Always create signal',
  never: 'Never create signal',
};

function signalReviewSelectNodes(
  settings: ReturnType<typeof getNrSettings>,
): WebNode[] {
  return [
    ['archive_signal_review_mode', 'Archive', settings.archiveSignalReviewMode],
    ['like_signal_review_mode', 'Like', settings.likeSignalReviewMode],
    ['reply_signal_review_mode', 'Reply', settings.replySignalReviewMode],
    [
      'repost_quote_signal_review_mode',
      'Repost / Quote',
      settings.repostQuoteSignalReviewMode,
    ],
  ].map(([fieldName, label, value]) =>
    el('row', { gap: 'xs', itemAlign: 'center' }, [
      el('text', { size: 'sm' }, [text(`${label}:`)]),
      el(
        'select',
        {
          formFieldName: fieldName,
          value,
          choices: SIGNAL_REVIEW_MODE_CHOICES,
          choiceLabels: SIGNAL_REVIEW_MODE_LABELS,
        },
        [],
      ),
    ]),
  );
}

function formatSettings(settings: ReturnType<typeof getNrSettings>): string {
  return [
    'Nostr radar settings:',
    `Backend: ${settings.backend ?? '(default)'}`,
    `Model: ${settings.model ?? '(default)'}`,
    `Event share URL: ${settings.eventSharePrefix}`,
    `Profile share URL: ${settings.profileSharePrefix}`,
    `Default language: ${settings.defaultLanguage ?? 'en'}`,
    `Translation target language: ${settings.translationTargetLanguage ?? 'en'}`,
    `Filter to latest fetched hour on open: ${
      settings.filterToLatestFetchedSlotOnOpen ? 'enabled' : 'disabled'
    }`,
    `Always resolve unresolved references: ${
      settings.alwaysResolveUnresolvedReferences ? 'enabled' : 'disabled'
    }`,
    `Relay fetch concurrency: ${settings.relayFetchConcurrency}`,
    `AI evaluation concurrency: ${settings.aiEvaluationConcurrency}`,
    '',
    'Signal review:',
    `Archive: ${SIGNAL_REVIEW_MODE_LABELS[settings.archiveSignalReviewMode]}`,
    `Like: ${SIGNAL_REVIEW_MODE_LABELS[settings.likeSignalReviewMode]}`,
    `Reply: ${SIGNAL_REVIEW_MODE_LABELS[settings.replySignalReviewMode]}`,
    `Repost / Quote: ${
      SIGNAL_REVIEW_MODE_LABELS[settings.repostQuoteSignalReviewMode]
    }`,
    '',
    'Instructions:',
    settings.instructions,
  ].join('\n');
}

type RenderSettingsWebProps = {
  alias: string;
  settings: ReturnType<typeof getNrSettings>;
  defaults: ReturnType<NrCommandAdapterParams['agent']['getDefaults']>;
  modelChoices: string[];
  agentOnly: boolean;
  message: string | null;
  scheduler: SchedulerSettingsState | null;
  schedulerSetupNeeded: boolean;
};

type SchedulerSettingsState = {
  resource: CapabilityResourceRef;
  status: 'draft' | 'created' | 'unavailable';
  enabled: boolean;
  scheduleDescription: string;
};

async function loadSchedulerSettingsState(
  params: NrCommandAdapterParams,
): Promise<SchedulerSettingsState | null> {
  const resource = getNrSchedulerResource(params.db);

  if (!resource) {
    return null;
  }

  const result = await params.storedCtx.capabilities.invoke({
    operation: SchedulerV1.operations.show,
    provider: resource.providerId,
    input: { resourceId: resource.resourceId },
  });

  if (result.status !== 'success') {
    return {
      resource,
      status: 'unavailable',
      enabled: false,
      scheduleDescription: 'Scheduler provider unavailable',
    };
  }

  return {
    resource: result.output.resource,
    status: result.output.status,
    enabled: result.output.enabled,
    scheduleDescription: result.output.scheduleDescription,
  };
}

type RenderSettingsResultProps = {
  params: NrCommandAdapterParams;
  settings: ReturnType<typeof getNrSettings>;
  message: string | null;
  schedulerSetupNeeded: boolean;
};

async function renderSettingsResult({
  params,
  settings,
  message,
  schedulerSetupNeeded,
}: RenderSettingsResultProps): Promise<WebNodeRoot> {
  const [modelChoices, scheduler] = await Promise.all([
    params.storedCtx.agent
      .getAvailableModels({ backend: settings.backend })
      .catch(() => []),
    loadSchedulerSettingsState(params),
  ]);

  return renderSettingsWeb({
    alias: params.alias,
    settings,
    defaults: params.storedCtx.agent.getDefaults(),
    modelChoices,
    agentOnly: parseBooleanOption(params.parsed.options.agent),
    message,
    scheduler,
    schedulerSetupNeeded,
  });
}

function renderSettingsWeb({
  alias,
  settings,
  defaults,
  modelChoices,
  agentOnly,
  message,
  scheduler,
  schedulerSetupNeeded,
}: RenderSettingsWebProps): WebNodeRoot {
  if (agentOnly) {
    const modelCatalog =
      settings.model && !modelChoices.includes(settings.model)
        ? [settings.model, ...modelChoices]
        : modelChoices;

    return {
      kind: 'ui',
      version: 1,
      meta: { command: alias, subcommand: 'settings' },
      tree: el('stack', { gap: 'sm' }, [
        ...(message
          ? [el('text', { tone: 'success', size: 'sm' }, [text(message)])]
          : []),
        el(
          'form',
          {
            className: 'web-form web-form--stacked',
            formOptionFieldNames: ['backend', 'model'],
            action: {
              type: 'command',
              command: alias,
              subcommand: 'settings',
              arguments: {},
              options: { agent: true },
              surface: 'modal',
              modalTitle: 'Nostr radar AI settings',
              recordInTimeline: false,
            },
          },
          [
            el('text', { weight: 'semibold' }, [
              text('Nostr radar AI settings'),
            ]),
            el('text', { weight: 'semibold', size: 'sm' }, [
              text('AI backend'),
            ]),
            el(
              'select',
              {
                formFieldName: 'backend',
                value: settings.backend ?? 'default',
                choices: ['default', 'cursor', 'opencode'],
                choiceLabels: {
                  default: `current (${defaults.backend})`,
                  cursor: 'cursor',
                  opencode: 'opencode',
                },
              },
              [],
            ),
            el('text', { weight: 'semibold', size: 'sm' }, [text('AI model')]),
            el(
              'textField',
              {
                formFieldName: 'model',
                inputPlaceholder: defaults.effectiveModel,
                value: settings.model ?? '',
                choices: ['reset', ...modelCatalog],
                choiceLabels: { reset: 'Clear / use current' },
              },
              [],
            ),
            el('row', { className: 'web-form__actions', gap: 'xs' }, [
              el('button', { label: 'Save', htmlType: 'submit' }, []),
            ]),
          ],
        ),
      ]),
    };
  }

  return {
    kind: 'ui',
    version: 1,
    meta: { command: alias, subcommand: 'settings' },
    tree: el('stack', { gap: 'sm' }, [
      ...(message
        ? [el('text', { tone: 'success', size: 'sm' }, [text(message)])]
        : []),
      el(
        'form',
        {
          className: 'web-form web-form--stacked',
          formOptionFieldNames: [
            'instructions',
            'event_share_prefix',
            'profile_share_prefix',
            'default_language',
            'translation_target_language',
            'hourly_scheduler',
            'filter_to_latest_fetched_slot_on_open',
            'always_resolve_unresolved_references',
            'relay_fetch_concurrency',
            'ai_evaluation_concurrency',
            'archive_signal_review_mode',
            'like_signal_review_mode',
            'reply_signal_review_mode',
            'repost_quote_signal_review_mode',
          ],
          action: {
            type: 'command',
            command: alias,
            subcommand: 'settings',
            arguments: {},
            options: {},
            surface: 'modal',
            modalTitle: 'Nostr radar settings',
            recordInTimeline: false,
          },
        },
        [
          el('text', { weight: 'semibold' }, [text('Nostr radar settings')]),
          el('text', { weight: 'semibold', size: 'sm' }, [
            text('Signal review'),
          ]),
          ...signalReviewSelectNodes(settings),
          el('text', { weight: 'semibold', size: 'sm' }, [
            text('Concurrent AI evaluators'),
          ]),
          el(
            'textField',
            {
              formFieldName: 'ai_evaluation_concurrency',
              inputPlaceholder: '2',
              value: String(settings.aiEvaluationConcurrency),
            },
            [],
          ),
          el('text', { weight: 'semibold', size: 'sm' }, [
            text('Classification instructions'),
          ]),
          el(
            'textArea',
            {
              formFieldName: 'instructions',
              inputPlaceholder: 'classification instructions',
              value: settings.instructions,
              maxRows: 14,
            },
            [],
          ),
          el('text', { weight: 'semibold', size: 'sm' }, [
            text('Event share URL'),
          ]),
          el(
            'textField',
            {
              formFieldName: 'event_share_prefix',
              inputPlaceholder:
                'nostr:// or https://jumble.social/notes/[nevent]',
              value: settings.eventSharePrefix,
            },
            [],
          ),
          el('text', { weight: 'semibold', size: 'sm' }, [
            text('Profile share URL'),
          ]),
          el(
            'textField',
            {
              formFieldName: 'profile_share_prefix',
              inputPlaceholder:
                'nostr:// or https://jumble.social/users/[nprofile]',
              value: settings.profileSharePrefix,
            },
            [],
          ),
          el('text', { weight: 'semibold', size: 'sm' }, [
            text('Default language'),
          ]),
          el(
            'textField',
            {
              formFieldName: 'default_language',
              inputPlaceholder: 'en (reset = English)',
              value: settings.defaultLanguage ?? '',
              choices: ['reset', 'en'],
              choiceLabels: { reset: 'Clear / use English' },
            },
            [],
          ),
          el('text', { weight: 'semibold', size: 'sm' }, [
            text('Translation target language'),
          ]),
          el(
            'textField',
            {
              formFieldName: 'translation_target_language',
              inputPlaceholder: 'en (reset = English)',
              value: settings.translationTargetLanguage ?? '',
              choices: ['reset', 'en'],
              choiceLabels: { reset: 'Clear / use English' },
            },
            [],
          ),
          el('text', { weight: 'semibold', size: 'sm' }, [text('Scheduling')]),
          el('row', { gap: 'xs', itemAlign: 'center' }, [
            el(
              'checkbox',
              {
                formFieldName: 'hourly_scheduler',
                value: 'true',
                checked: scheduler !== null,
                disabled: scheduler !== null,
                className: 'web-checkbox--retro',
              },
              [],
            ),
            text('Create hourly scheduler to fetch and evaluate'),
          ]),
          ...(scheduler
            ? [
                el('text', { tone: 'muted', size: 'sm' }, [
                  text(
                    `Status: ${scheduler.status}${scheduler.enabled ? ' · enabled' : ''} · ${scheduler.scheduleDescription}`,
                  ),
                ]),
                ...(scheduler.status === 'unavailable'
                  ? []
                  : [
                      el(
                        'button',
                        {
                          label:
                            scheduler.status === 'draft'
                              ? 'Review scheduled job'
                              : 'View scheduled job',
                          action: {
                            type: 'capability',
                            operation: SchedulerV1.operations.show.id,
                            input: {
                              resourceId: scheduler.resource.resourceId,
                            },
                            consumerAlias: alias,
                            providerId: scheduler.resource.providerId,
                            selection: 'auto',
                            surface: 'modal',
                            modalTitle: 'Scheduled Nostr Radar job',
                          },
                        },
                        [],
                      ),
                    ]),
              ]
            : []),
          ...(schedulerSetupNeeded
            ? [
                el('text', { tone: 'warning', size: 'sm' }, [
                  text('Choose or install a scheduler provider to continue.'),
                ]),
                el(
                  'button',
                  {
                    label: 'Configure scheduler',
                    action: {
                      type: 'command',
                      command: alias,
                      subcommand: 'schedule',
                      arguments: {},
                      options: {},
                      surface: 'modal',
                      modalTitle: 'Nostr radar schedule',
                      recordInTimeline: false,
                    },
                  },
                  [],
                ),
              ]
            : []),
          el('text', { weight: 'semibold', size: 'sm' }, [
            text('Initial time filter'),
          ]),
          el(
            'select',
            {
              formFieldName: 'filter_to_latest_fetched_slot_on_open',
              value: settings.filterToLatestFetchedSlotOnOpen
                ? 'enabled'
                : 'disabled',
              choices: ['enabled', 'disabled'],
              choiceLabels: {
                enabled: 'Latest fetched hour',
                disabled: 'No initial time filter',
              },
            },
            [],
          ),
          el('text', { weight: 'semibold', size: 'sm' }, [
            text('Unresolved references'),
          ]),
          el(
            'select',
            {
              formFieldName: 'always_resolve_unresolved_references',
              value: settings.alwaysResolveUnresolvedReferences
                ? 'enabled'
                : 'disabled',
              choices: ['enabled', 'disabled'],
              choiceLabels: {
                enabled: 'Always resolve automatically',
                disabled: 'Show on demand',
              },
            },
            [],
          ),
          el('text', { weight: 'semibold', size: 'sm' }, [
            text('Concurrent relay groups'),
          ]),
          el(
            'textField',
            {
              formFieldName: 'relay_fetch_concurrency',
              inputPlaceholder: '3',
              value: String(settings.relayFetchConcurrency),
            },
            [],
          ),
          el('row', { className: 'web-form__actions', gap: 'xs' }, [
            el('button', { label: 'Save', htmlType: 'submit' }, []),
            el(
              'button',
              {
                label: 'Reset',
                action: {
                  type: 'command',
                  command: alias,
                  subcommand: 'settings',
                  arguments: {},
                  options: { reset: true },
                  surface: 'modal',
                  modalTitle: 'Nostr radar settings',
                  recordInTimeline: false,
                },
              },
              [],
            ),
          ]),
        ],
      ),
    ]),
  };
}

export async function adaptSettingsCommand(params: NrCommandAdapterParams) {
  void params.command;
  void params.identity;
  void params.agent;

  if (parseBooleanOption(params.parsed.options.reset)) {
    const settings = resetNrSettings(params.db);

    if (params.source === 'web') {
      return renderSettingsResult({
        params,
        settings,
        message: 'Reset Nostr radar settings.',
        schedulerSetupNeeded: false,
      });
    }

    return ['Reset Nostr radar settings.', formatSettings(settings)].join(
      '\n\n',
    );
  }

  const backend = parseBackend(params.parsed.options.backend);
  const modelValue = asOptionalStringOverride(params.parsed.options.model);
  const model = modelValue === 'reset' ? null : modelValue;

  const instructions = asOptionalStringOverride(
    params.parsed.options.instructions,
  );

  const eventSharePrefix = asOptionalStringOverride(
    params.parsed.options.event_share_prefix,
  );

  const profileSharePrefix = asOptionalStringOverride(
    params.parsed.options.profile_share_prefix,
  );

  const translationTargetLanguageValue = asOptionalStringOverride(
    params.parsed.options.translation_target_language,
  );

  const defaultLanguageValue = asOptionalStringOverride(
    params.parsed.options.default_language,
  );

  const defaultLanguage =
    defaultLanguageValue === 'reset' ? null : defaultLanguageValue;

  const translationTargetLanguage =
    translationTargetLanguageValue === 'reset'
      ? null
      : translationTargetLanguageValue;

  const relayFetchConcurrency = parsePositiveInteger(
    params.parsed.options.relay_fetch_concurrency,
  );

  const aiEvaluationConcurrency = parsePositiveInteger(
    params.parsed.options.ai_evaluation_concurrency,
  );

  const hourlySchedulerRequested = parseBooleanOption(
    params.parsed.options.hourly_scheduler,
  );

  const filterToLatestFetchedSlotOnOpen = parseEnabledSetting(
    params.parsed.options.filter_to_latest_fetched_slot_on_open,
  );

  const alwaysResolveUnresolvedReferences = parseEnabledSetting(
    params.parsed.options.always_resolve_unresolved_references,
  );

  const archiveSignalReviewMode = parseSignalReviewMode(
    params.parsed.options.archive_signal_review_mode,
    'Archive signal review mode',
  );

  const likeSignalReviewMode = parseSignalReviewMode(
    params.parsed.options.like_signal_review_mode,
    'Like signal review mode',
  );

  const replySignalReviewMode = parseSignalReviewMode(
    params.parsed.options.reply_signal_review_mode,
    'Reply signal review mode',
  );

  const repostQuoteSignalReviewMode = parseSignalReviewMode(
    params.parsed.options.repost_quote_signal_review_mode,
    'Repost/quote signal review mode',
  );

  const hasUpdates =
    backend !== undefined ||
    model !== undefined ||
    instructions !== undefined ||
    eventSharePrefix !== undefined ||
    profileSharePrefix !== undefined ||
    defaultLanguage !== undefined ||
    translationTargetLanguage !== undefined ||
    filterToLatestFetchedSlotOnOpen !== undefined ||
    alwaysResolveUnresolvedReferences !== undefined ||
    hourlySchedulerRequested ||
    relayFetchConcurrency !== undefined ||
    aiEvaluationConcurrency !== undefined ||
    archiveSignalReviewMode !== undefined ||
    likeSignalReviewMode !== undefined ||
    replySignalReviewMode !== undefined ||
    repostQuoteSignalReviewMode !== undefined;

  if (!hasUpdates) {
    const settings = getNrSettings(params.db);

    if (params.source === 'web') {
      return renderSettingsResult({
        params,
        settings,
        message: null,
        schedulerSetupNeeded: false,
      });
    }

    return formatSettings(settings);
  }

  const current = getNrSettings(params.db);

  const next = saveNrSettings({
    db: params.db,
    backend: backend === undefined ? current.backend : backend,
    model: model === undefined ? current.model : model,
    instructions:
      instructions === undefined ? current.instructions : instructions,
    eventSharePrefix:
      eventSharePrefix === undefined
        ? current.eventSharePrefix
        : (eventSharePrefix ?? ''),
    profileSharePrefix:
      profileSharePrefix === undefined
        ? current.profileSharePrefix
        : (profileSharePrefix ?? ''),
    defaultLanguage:
      defaultLanguage === undefined ? current.defaultLanguage : defaultLanguage,
    translationTargetLanguage:
      translationTargetLanguage === undefined
        ? current.translationTargetLanguage
        : translationTargetLanguage,
    filterToLatestFetchedSlotOnOpen:
      filterToLatestFetchedSlotOnOpen ??
      current.filterToLatestFetchedSlotOnOpen,
    alwaysResolveUnresolvedReferences:
      alwaysResolveUnresolvedReferences ??
      current.alwaysResolveUnresolvedReferences,
    relayFetchConcurrency:
      relayFetchConcurrency ?? current.relayFetchConcurrency,
    aiEvaluationConcurrency:
      aiEvaluationConcurrency ?? current.aiEvaluationConcurrency,
    archiveSignalReviewMode:
      archiveSignalReviewMode ?? current.archiveSignalReviewMode,
    likeSignalReviewMode: likeSignalReviewMode ?? current.likeSignalReviewMode,
    replySignalReviewMode:
      replySignalReviewMode ?? current.replySignalReviewMode,
    repostQuoteSignalReviewMode:
      repostQuoteSignalReviewMode ?? current.repostQuoteSignalReviewMode,
  });

  let schedulerSetupNeeded = false;
  let schedulerCreated = false;

  if (hourlySchedulerRequested && !getNrSchedulerResource(params.db)) {
    const result = await params.storedCtx.capabilities.invoke({
      operation: SchedulerV1.operations.create,
      provider: 'auto',
      input: NR_HOURLY_SCHEDULER_INPUT,
    });

    if (result.status === 'success') {
      saveNrSchedulerResource(params.db, result.output.resource);
      schedulerCreated = true;
    } else {
      schedulerSetupNeeded = true;
    }
  }

  if (params.source === 'web') {
    return renderSettingsResult({
      params,
      settings: next,
      message: schedulerCreated
        ? 'Saved settings and created the hourly scheduler.'
        : 'Saved Nostr radar settings.',
      schedulerSetupNeeded,
    });
  }

  return ['Saved Nostr radar settings.', formatSettings(next)].join('\n\n');
}
