import type { WebNode, WebNodeRoot } from '@src/web/ui-schema';

import { listActiveNrTaxonomyTerms, syncNrTaxonomyTerms } from '../../db';
import type { NrCommandAdapterParams } from '../../types/adapter-params';

import type { NrTaxonomyTermType } from '../shared/types';

function text(value: string): WebNode {
  return { type: 'text', value };
}

type WebElementTag = Extract<WebNode, { type: 'element' }>['tag'];

function el(
  tag: WebElementTag,
  props: Record<string, unknown>,
  children: WebNode[],
): WebNode {
  return { type: 'element', tag, props, children } as WebNode;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stringArrayValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }

  return typeof value === 'string' && value.trim() ? [value.trim()] : [];
}

function taxonomyType(value: unknown): NrTaxonomyTermType | null {
  const text = stringValue(value);

  return text === 'topic' || text === 'mood' ? text : null;
}

function titleForType(type: NrTaxonomyTermType): string {
  return type === 'topic' ? 'Topics' : 'Moods';
}

function renderTaxonomyEditor({
  alias,
  type,
  saved,
  terms,
}: {
  alias: string;
  type: NrTaxonomyTermType;
  saved: boolean;
  terms: string[];
}): WebNodeRoot {
  return {
    kind: 'ui',
    version: 1,
    meta: { command: alias, subcommand: 'taxonomy' },
    tree: el('stack', { gap: 'sm' }, [
      el('text', { weight: 'bold' }, [text(`Manual ${titleForType(type)}`)]),
      ...(saved
        ? [
            el('text', { tone: 'success', size: 'sm' }, [
              text('Saved manual taxonomy terms.'),
            ]),
          ]
        : []),
      el('text', { tone: 'muted', size: 'sm' }, [
        text(
          `Checked ${type}s are offered to the classifier. Uncheck a term to remove it from the manual list; existing post tags are not rewritten.`,
        ),
      ]),
      el(
        'form',
        {
          className: 'web-form web-form--stacked',
          formOptionFieldNames: ['active_tags', 'new_tag'],
          action: {
            type: 'command',
            command: alias,
            subcommand: 'taxonomy',
            arguments: {},
            options: { type, mode: 'save' },
            recordInTimeline: false,
          },
        },
        [
          ...(terms.length === 0
            ? [
                el('text', { tone: 'muted', size: 'sm' }, [
                  text(`No manual ${type}s yet.`),
                ]),
              ]
            : terms.map((term) =>
                el('row', { gap: 'xs', itemAlign: 'center' }, [
                  el(
                    'checkbox',
                    {
                      formFieldName: 'active_tags',
                      value: term,
                      checked: true,
                    },
                    [],
                  ),
                  el('text', {}, [text(term)]),
                ]),
              )),
          el(
            'textField',
            {
              formFieldName: 'new_tag',
              inputPlaceholder: `new ${type}`,
              autoFocus: true,
            },
            [],
          ),
          el('row', { className: 'web-form__actions' }, [
            el('button', { label: 'Save', htmlType: 'submit' }, []),
          ]),
        ],
      ),
    ]),
  };
}

export function adaptTaxonomyCommand(
  params: NrCommandAdapterParams,
): string | WebNodeRoot {
  void params.command;
  void params.identity;
  void params.runAgent;
  void params.storedCtx;

  const type = taxonomyType(params.parsed.options.type);

  if (!type) {
    return `Usage: ${params.prefix}${params.alias} taxonomy --type <topic|mood>`;
  }

  const mode = stringValue(params.parsed.options.mode) ?? 'edit';

  if (mode !== 'edit' && mode !== 'save' && mode !== 'add') {
    return 'Taxonomy mode must be edit, save, or add.';
  }

  if (mode === 'save' || mode === 'add') {
    const newTag = stringValue(params.parsed.options.new_tag);

    const activeTags =
      mode === 'add'
        ? listActiveNrTaxonomyTerms({ db: params.db, type }).map(
            (term) => term.tag,
          )
        : stringArrayValue(params.parsed.options.active_tags);

    if (mode === 'add' && !newTag) {
      return `Usage: ${params.prefix}${params.alias} taxonomy --type <topic|mood> --mode add --new-tag <tag>`;
    }

    syncNrTaxonomyTerms({
      db: params.db,
      type,
      activeTags,
      newTag,
    });

    if (mode === 'add') {
      return `Added ${newTag} to preferred ${type}s.`;
    }
  }

  const terms = listActiveNrTaxonomyTerms({ db: params.db, type }).map(
    (term) => term.tag,
  );

  if (params.source !== 'web') {
    return terms.length > 0
      ? `${titleForType(type)}: ${terms.join(', ')}`
      : `${titleForType(type)}: (none)`;
  }

  return renderTaxonomyEditor({
    alias: params.alias,
    type,
    saved: mode === 'save',
    terms,
  });
}
