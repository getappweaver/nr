import type { AgentBackendName } from '@src/db';
import type { WebNode, WebNodeRoot } from '@src/web/ui-schema';

import { getNrSettings, resetNrSettings, saveNrSettings } from '../../settings';
import type { NrCommandAdapterParams } from '../../types/adapter-params';

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

function parseBackend(value: unknown): AgentBackendName | null | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (value === '') {
    return null;
  }

  if (value === 'cursor' || value === 'opencode') {
    return value;
  }

  throw new Error('backend must be cursor or opencode');
}

function formatSettings(settings: ReturnType<typeof getNrSettings>): string {
  return [
    'nr parse AI settings:',
    `Backend: ${settings.backend ?? '(default)'}`,
    `Model: ${settings.model ?? '(default)'}`,
    '',
    'Instructions:',
    settings.instructions,
  ].join('\n');
}

type RenderSettingsWebProps = {
  alias: string;
  settings: ReturnType<typeof getNrSettings>;
  message: string | null;
};

function renderSettingsWeb({
  alias,
  settings,
  message,
}: RenderSettingsWebProps): WebNodeRoot {
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
          formOptionFieldNames: ['backend', 'model', 'instructions'],
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
          el(
            'select',
            {
              formFieldName: 'backend',
              value: settings.backend ?? '',
              choices: ['', 'cursor', 'opencode'],
              choiceLabels: {
                '': 'default',
                cursor: 'cursor',
                opencode: 'opencode',
              },
            },
            [],
          ),
          el(
            'textField',
            {
              formFieldName: 'model',
              inputPlaceholder: 'model override (empty = default)',
              value: settings.model ?? '',
            },
            [],
          ),
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

export function adaptSettingsCommand(params: NrCommandAdapterParams) {
  void params.command;
  void params.identity;
  void params.runAgent;
  void params.storedCtx;

  if (parseBooleanOption(params.parsed.options.reset)) {
    const settings = resetNrSettings(params.db);

    if (params.source === 'web') {
      return renderSettingsWeb({
        alias: params.alias,
        settings,
        message: 'Reset nr parse AI settings.',
      });
    }

    return ['Reset nr parse AI settings.', formatSettings(settings)].join(
      '\n\n',
    );
  }

  const backend = parseBackend(params.parsed.options.backend);
  const model = asOptionalStringOverride(params.parsed.options.model);

  const instructions = asOptionalStringOverride(
    params.parsed.options.instructions,
  );

  const hasUpdates =
    backend !== undefined || model !== undefined || instructions !== undefined;

  if (!hasUpdates) {
    const settings = getNrSettings(params.db);

    if (params.source === 'web') {
      return renderSettingsWeb({
        alias: params.alias,
        settings,
        message: null,
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
  });

  if (params.source === 'web') {
    return renderSettingsWeb({
      alias: params.alias,
      settings: next,
      message: 'Saved nr parse AI settings.',
    });
  }

  return ['Saved nr parse AI settings.', formatSettings(next)].join('\n\n');
}
