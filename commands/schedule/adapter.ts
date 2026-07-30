import {
  SchedulerV1,
  type SchedulerCreateInputV1,
} from '@src/capabilities/scheduler.v1';
import type { WebNode, WebNodeRoot } from '@src/web/ui-schema';

import {
  getNrSchedulerResource,
  saveNrSchedulerResource,
} from '../../settings';
import type { NrCommandAdapterParams } from '../../types/adapter-params';

export const NR_HOURLY_SCHEDULER_INPUT: SchedulerCreateInputV1 = {
  name: 'Nostr Radar fetch and evaluate',
  schedule: {
    type: 'cron',
    expression: '5 * * * *',
    description: 'Hourly, five minutes after the hour',
    maxRuns: null,
  },
  task: {
    type: 'agent-prompt',
    prompt:
      "Run `bun src/cli.ts nr fetch_evaluate '{}'` to fetch and evaluate the user's Nostr posts.",
    mode: 'agent',
    workspaceTarget: 'appweaver',
  },
  enabled: true,
};

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
            text('Scheduling requires an installed scheduler:v1 service.'),
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
              payload: { filter: 'capability:scheduler:v1' },
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
    const result = await params.storedCtx.capabilities.invoke({
      operation: SchedulerV1.operations.show,
      provider: stored.providerId,
      input: { resourceId: stored.resourceId },
    });

    if (result.status === 'success') {
      return params.source === 'web' && result.output.view
        ? result.output.view
        : `Scheduled job: ${result.output.name} (${result.output.status})`;
    }

    return params.source === 'web'
      ? missingProviderRoot(params.alias)
      : 'The configured scheduler provider is unavailable.';
  }

  const providerOption = params.parsed.options.provider;

  const result = await params.storedCtx.capabilities.invoke({
    operation: SchedulerV1.operations.create,
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
