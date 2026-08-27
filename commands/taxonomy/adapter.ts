import type { WebNode, WebNodeRoot } from '@src/web/ui-schema';

import { listActiveNrTaxonomyTerms, syncNrTaxonomyTerms } from '../../db';
import type { NrCommandAdapterParams } from '../../types/adapter-params';

import type {
  NrTaxonomyPreference,
  NrTaxonomyTerm,
  NrTaxonomyTermType,
} from '../shared/types';

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

function taxonomyPreference(value: unknown): NrTaxonomyPreference | null {
  const preference = stringValue(value);

  return preference === 'interested' || preference === 'uninterested'
    ? preference
    : null;
}

function titleForType(type: NrTaxonomyTermType): string {
  return type === 'topic' ? 'Topics' : 'Moods';
}

type RenderTaxonomyEditorProps = {
  alias: string;
  type: NrTaxonomyTermType;
  saved: boolean;
  terms: NrTaxonomyTerm[];
};

function renderTaxonomyEditor({
  alias,
  type,
  saved,
  terms,
}: RenderTaxonomyEditorProps): WebNodeRoot {
  const interestedTerms = terms
    .filter((term) => term.preference === 'interested')
    .map((term) => term.tag);

  const uninterestedTerms = terms
    .filter((term) => term.preference === 'uninterested')
    .map((term) => term.tag);

  const isTopic = type === 'topic';

  return {
    kind: 'ui',
    version: 1,
    meta: { command: alias, subcommand: 'taxonomy' },
    tree: el('stack', { gap: 'sm' }, [
      el('text', { weight: 'bold' }, [
        text(isTopic ? 'Topic preferences' : `Manual ${titleForType(type)}`),
      ]),
      ...(saved
        ? [
            el('text', { tone: 'success', size: 'sm' }, [
              text(
                isTopic ? 'Saved topic preferences.' : 'Saved manual moods.',
              ),
            ]),
          ]
        : []),
      el('text', { tone: 'muted', size: 'sm' }, [
        text(
          isTopic
            ? 'Interested topics help retain relevant posts; uninterested topics help skip posts centrally about those subjects. Uncheck a topic to remove the preference.'
            : 'Checked moods are offered to the classifier. Uncheck a mood to remove it from the manual list; existing post tags are not rewritten.',
        ),
      ]),
      el(
        'form',
        {
          className: 'web-form web-form--stacked',
          formOptionFieldNames: isTopic
            ? [
                'interested_tags',
                'uninterested_tags',
                'new_interested_tag',
                'new_uninterested_tag',
              ]
            : ['active_tags', 'new_tag'],
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
          ...(isTopic
            ? [
                el('text', { weight: 'bold', size: 'sm' }, [
                  text('Interested topics'),
                ]),
                ...(interestedTerms.length === 0
                  ? [
                      el('text', { tone: 'muted', size: 'sm' }, [
                        text('No interested topics yet.'),
                      ]),
                    ]
                  : interestedTerms.map((term) =>
                      el('row', { gap: 'xs', itemAlign: 'center' }, [
                        el(
                          'checkbox',
                          {
                            formFieldName: 'interested_tags',
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
                    formFieldName: 'new_interested_tag',
                    inputPlaceholder: 'new interested topic',
                    autoFocus: true,
                  },
                  [],
                ),
                el('text', { weight: 'bold', size: 'sm' }, [
                  text('Uninterested topics'),
                ]),
                ...(uninterestedTerms.length === 0
                  ? [
                      el('text', { tone: 'muted', size: 'sm' }, [
                        text('No uninterested topics yet.'),
                      ]),
                    ]
                  : uninterestedTerms.map((term) =>
                      el('row', { gap: 'xs', itemAlign: 'center' }, [
                        el(
                          'checkbox',
                          {
                            formFieldName: 'uninterested_tags',
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
                    formFieldName: 'new_uninterested_tag',
                    inputPlaceholder: 'new uninterested topic',
                  },
                  [],
                ),
              ]
            : [
                ...(interestedTerms.length === 0
                  ? [
                      el('text', { tone: 'muted', size: 'sm' }, [
                        text('No manual moods yet.'),
                      ]),
                    ]
                  : interestedTerms.map((term) =>
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
                    inputPlaceholder: 'new mood',
                    autoFocus: true,
                  },
                  [],
                ),
              ]),
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
  void params.agent;
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
    const currentTerms = listActiveNrTaxonomyTerms({ db: params.db, type });
    const newTag = stringValue(params.parsed.options.new_tag);
    const preference = taxonomyPreference(params.parsed.options.preference);

    if (mode === 'add' && !newTag) {
      return `Usage: ${params.prefix}${params.alias} taxonomy --type <topic|mood> --mode add --new-tag <tag>`;
    }

    if (params.parsed.options.preference !== undefined && !preference) {
      return 'Taxonomy preference must be interested or uninterested.';
    }

    const currentInterestedTags = currentTerms
      .filter((term) => term.preference === 'interested')
      .map((term) => term.tag);

    const currentUninterestedTags = currentTerms
      .filter((term) => term.preference === 'uninterested')
      .map((term) => term.tag);

    const usesTopicFields =
      params.parsed.options.interested_tags !== undefined ||
      params.parsed.options.uninterested_tags !== undefined ||
      params.parsed.options.new_interested_tag !== undefined ||
      params.parsed.options.new_uninterested_tag !== undefined;

    const interestedTags =
      mode === 'add'
        ? currentInterestedTags
        : type === 'topic' && usesTopicFields
          ? stringArrayValue(params.parsed.options.interested_tags)
          : stringArrayValue(params.parsed.options.active_tags);

    const uninterestedTags =
      mode === 'add'
        ? currentUninterestedTags
        : type === 'topic' && usesTopicFields
          ? stringArrayValue(params.parsed.options.uninterested_tags)
          : [];

    const addAsUninterested =
      mode === 'add' && type === 'topic' && preference === 'uninterested';

    syncNrTaxonomyTerms({
      db: params.db,
      type,
      interestedTags,
      uninterestedTags,
      newInterestedTag:
        mode === 'add'
          ? addAsUninterested
            ? null
            : newTag
          : type === 'topic'
            ? (stringValue(params.parsed.options.new_interested_tag) ?? newTag)
            : newTag,
      newUninterestedTag:
        mode === 'add'
          ? addAsUninterested
            ? newTag
            : null
          : type === 'topic'
            ? stringValue(params.parsed.options.new_uninterested_tag)
            : null,
    });

    if (mode === 'add') {
      const destination = addAsUninterested ? 'uninterested' : 'interested';

      return type === 'topic'
        ? `Added ${newTag} to ${destination} topics.`
        : `Added ${newTag} to preferred moods.`;
    }
  }

  const terms = listActiveNrTaxonomyTerms({ db: params.db, type });

  if (params.source !== 'web') {
    if (type === 'topic') {
      const interested = terms
        .filter((term) => term.preference === 'interested')
        .map((term) => term.tag);

      const uninterested = terms
        .filter((term) => term.preference === 'uninterested')
        .map((term) => term.tag);

      return [
        `Interested topics: ${interested.join(', ') || '(none)'}`,
        `Uninterested topics: ${uninterested.join(', ') || '(none)'}`,
      ].join('\n');
    }

    const moods = terms.map((term) => term.tag);

    return moods.length > 0
      ? `${titleForType(type)}: ${moods.join(', ')}`
      : `${titleForType(type)}: (none)`;
  }

  return renderTaxonomyEditor({
    alias: params.alias,
    type,
    saved: mode === 'save',
    terms,
  });
}
