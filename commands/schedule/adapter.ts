import {
  SchedulerV2,
  type SchedulerCreateInputV2,
  type SchedulerTaskV2,
} from '@src/capabilities/scheduler.v2';
import { CapabilityError } from '@src/core/capabilities/errors';
import type { WebNode, WebNodeRoot } from '@src/web/ui-schema';

import {
  clearNrSchedulerResource,
  getNrSchedulerResource,
  saveNrSchedulerResource,
} from '../../settings';
import type { NrCommandAdapterParams } from '../../types/adapter-params';

const NR_FETCH_TASK = {
  type: 'plugin-tool',
  alias: 'nr',
  toolName: 'fetch_evaluate',
  input: {},
} satisfies SchedulerTaskV2;

export const NR_HOURLY_SCHEDULER_INPUT: SchedulerCreateInputV2 = {
  name: 'Nostr Radar fetch and evaluate',
  schedule: {
    type: 'cron',
    expression: '5 * * * *',
    description: 'Hourly, five minutes after the hour',
    maxRuns: null,
  },
  task: NR_FETCH_TASK,
  enabled: true,
};

export async function loadNrSchedulerV2(
  params: Pick<NrCommandAdapterParams, 'db' | 'storedCtx'>,
) {
  const stored = getNrSchedulerResource(params.db);

  if (!stored) {
    return null;
  }

  try {
    const shown = await params.storedCtx.capabilities.invoke({
      operation: SchedulerV2.operations.show,
      provider: stored.capability.version === 2 ? stored.providerId : 'auto',
      input: { resourceId: stored.resourceId },
    });

    if (shown.status !== 'success') {
      return null;
    }

    const task = shown.output.task;
    const expected = NR_FETCH_TASK;

    const isCurrent =
      task.type === 'plugin-tool' &&
      task.alias === expected.alias &&
      task.toolName === expected.toolName &&
      JSON.stringify(task.input) === JSON.stringify(expected.input);

    if (isCurrent) {
      saveNrSchedulerResource(params.db, shown.output.resource);

      return shown.output;
    }

    const updated = await params.storedCtx.capabilities.invoke({
      operation: SchedulerV2.operations['update-task'],
      provider: shown.provider.providerId,
      input: {
        resourceId: stored.resourceId,
        task: expected,
      },
    });

    if (updated.status !== 'success') {
      return null;
    }

    saveNrSchedulerResource(params.db, updated.output.resource);

    return { ...shown.output, ...updated.output };
  } catch (error) {
    if (
      error instanceof CapabilityError &&
      error.code === 'CAPABILITY_RESOURCE_NOT_FOUND'
    ) {
      clearNrSchedulerResource(params.db);
    }

    return null;
  }
}

function text(value: string): WebNode {
  return { type: 'text', value };
}

function missingProviderRoot(alias: string): WebNodeRoot {
  return {
    kind: 'ui',
    version: 1,
    meta: { command: alias, subcommand: 'schedule' },
    tree: {
      type: 'element',
      tag: 'stack',
      props: { gap: 'sm' },
      children: [
        {
          type: 'element',
          tag: 'text',
          children: [
            text('Scheduling requires an installed scheduler:v2 service.'),
          ],
        },
        {
          type: 'element',
          tag: 'button',
          props: {
            label: 'Find compatible apps',
            action: {
              type: 'clientAction',
              action: 'plugins.openCatalog',
              payload: { filter: 'capability:scheduler:v2' },
            },
          },
        },
      ],
    },
  };
}

function providerChooserRoot(
  alias: string,
  providers: Array<{
    providerId: string;
    source: {
      title: string;
      alias: string;
      description: string | null;
      iconUrl: string | null;
      version: string;
    };
  }>,
): WebNodeRoot {
  return {
    kind: 'ui',
    version: 1,
    meta: { command: alias, subcommand: 'schedule' },
    tree: {
      type: 'element',
      tag: 'stack',
      props: { gap: 'sm' },
      children: [
        {
          type: 'element',
          tag: 'text',
          props: { weight: 'bold' },
          children: [text('Choose a scheduler')],
        },
        ...providers.map((provider) => ({
          type: 'element' as const,
          tag: 'row' as const,
          props: { gap: 'sm' as const },
          children: [
            ...(provider.source.iconUrl
              ? [
                  {
                    type: 'element' as const,
                    tag: 'image' as const,
                    props: {
                      src: provider.source.iconUrl,
                      alt: '',
                    },
                  },
                ]
              : []),
            {
              type: 'element' as const,
              tag: 'stack' as const,
              props: { gap: 'xs' as const, fill: true as const },
              children: [
                {
                  type: 'element' as const,
                  tag: 'text' as const,
                  props: { weight: 'semibold' as const },
                  children: [text(provider.source.title)],
                },
                {
                  type: 'element' as const,
                  tag: 'text' as const,
                  props: { tone: 'muted' as const, size: 'sm' as const },
                  children: [
                    text(
                      `/${provider.source.alias} v${provider.source.version}${provider.source.description ? ` - ${provider.source.description}` : ''}`,
                    ),
                  ],
                },
              ],
            },
            {
              type: 'element' as const,
              tag: 'button' as const,
              props: {
                label: 'Use',
                action: {
                  type: 'command' as const,
                  command: alias,
                  subcommand: 'schedule',
                  arguments: {},
                  options: { provider: provider.providerId },
                  recordInTimeline: false,
                },
              },
            },
          ],
        })),
      ],
    },
  };
}

export async function adaptScheduleCommand(
  params: NrCommandAdapterParams,
): Promise<string | WebNodeRoot> {
  const stored = getNrSchedulerResource(params.db);

  if (stored) {
    const output = await loadNrSchedulerV2(params);

    if (output) {
      return params.source === 'web' && output.view
        ? output.view
        : `Scheduled job: ${output.name} (${output.status})`;
    }

    return params.source === 'web'
      ? missingProviderRoot(params.alias)
      : 'The configured scheduler provider is unavailable.';
  }

  const providerOption = params.parsed.options.provider;

  const result = await params.storedCtx.capabilities.invoke({
    operation: SchedulerV2.operations.create,
    provider: typeof providerOption === 'string' ? providerOption : 'auto',
    input: NR_HOURLY_SCHEDULER_INPUT,
  });

  if (result.status === 'missing') {
    return params.source === 'web'
      ? missingProviderRoot(params.alias)
      : 'Scheduling requires an installed scheduler:v1 service.';
  }

  if (result.status === 'selection-required') {
    return params.source === 'web'
      ? providerChooserRoot(params.alias, result.providers)
      : `Choose a scheduler provider: ${result.providers.map((provider) => provider.providerId).join(', ')}`;
  }

  saveNrSchedulerResource(params.db, result.output.resource);

  return params.source === 'web' && result.output.review
    ? result.output.review
    : `Scheduler created: ${result.output.resource.resourceId}`;
}
