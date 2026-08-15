import type { WebAction, WebNode, WebNodeRoot } from '@src/web/ui-schema';

const signalReviewStylesheet = {
  id: 'nr-signal-review',
  cssText: `
.nr-signal-review-form {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding-right: 0.25rem;
  scrollbar-gutter: stable;
}
`,
};

export type SignalReviewActionCategory =
  | 'archive'
  | 'like'
  | 'reply'
  | 'repost_quote'
  | 'local_like'
  | 'local_dislike';

export type SignalReviewOutcome = 'create' | 'without_signal';

export type SignalReviewFieldsProps = {
  targetAuthorPubkey: string | null;
  targetAuthorLabel: string;
  candidateTopics: string[];
  allowRemember: boolean;
  rememberLabel: string;
};

export type SignalReviewFormProps = SignalReviewFieldsProps & {
  title: string;
  createLabel: string;
  withoutSignalLabel: string | null;
  createAction: WebAction;
  withoutSignalAction: WebAction | null;
  cancelAction: WebAction | null;
  formOptionFieldNames: string[];
};

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

function checkboxRow({
  fieldName,
  value,
  label,
  checked,
}: {
  fieldName: string;
  value: string;
  label: string;
  checked: boolean;
}): WebNode {
  return el('row', { gap: 'xs', itemAlign: 'center' }, [
    el(
      'checkbox',
      {
        formFieldName: fieldName,
        value,
        checked,
        className: 'web-checkbox--retro',
      },
      [],
    ),
    text(label),
  ]);
}

export function renderSignalReviewFields({
  targetAuthorPubkey,
  targetAuthorLabel,
  candidateTopics,
  allowRemember,
  rememberLabel,
}: SignalReviewFieldsProps): WebNode[] {
  return [
    el('text', { weight: 'semibold', size: 'sm' }, [text('Author')]),
    ...(targetAuthorPubkey
      ? [
          checkboxRow({
            fieldName: 'signal_author_pubkey',
            value: targetAuthorPubkey,
            label: targetAuthorLabel,
            checked: true,
          }),
        ]
      : [
          el('text', { tone: 'muted', size: 'sm' }, [text('No cached author')]),
        ]),
    el('text', { weight: 'semibold', size: 'sm' }, [text('Topics')]),
    ...(candidateTopics.length > 0
      ? candidateTopics.map((topic) =>
          checkboxRow({
            fieldName: 'signal_topics',
            value: topic,
            label: topic,
            checked: true,
          }),
        )
      : [el('text', { tone: 'muted', size: 'sm' }, [text('No topics')])]),
    ...(allowRemember
      ? [
          el('divider', { className: 'web-form__section-divider' }, []),
          checkboxRow({
            fieldName: 'signal_remember',
            value: 'true',
            label: rememberLabel,
            checked: false,
          }),
        ]
      : []),
  ];
}

export function withSignalReviewDefaults({
  action,
  outcome,
}: {
  action: WebAction;
  outcome: SignalReviewOutcome;
}): WebAction {
  if (action.type === 'command') {
    return {
      ...action,
      options: {
        signal_outcome: outcome,
        signal_topics: [],
        ...(action.options ?? {}),
      },
    };
  }

  if (action.type === 'clientAction') {
    return {
      ...action,
      payload: {
        signal_outcome: outcome,
        signal_topics: [],
        ...(action.payload ?? {}),
      },
    };
  }

  return action;
}

export function renderSignalReviewForm({
  title,
  targetAuthorPubkey,
  targetAuthorLabel,
  candidateTopics,
  allowRemember,
  rememberLabel,
  createLabel,
  withoutSignalLabel,
  createAction,
  withoutSignalAction,
  cancelAction,
  formOptionFieldNames,
}: SignalReviewFormProps): WebNode {
  return el(
    'form',
    {
      className: 'web-form web-form--stacked nr-signal-review-form',
      formOptionFieldNames,
      action: withSignalReviewDefaults({
        action: createAction,
        outcome: 'create',
      }),
    },
    [
      el('text', { weight: 'semibold' }, [text(title)]),
      ...renderSignalReviewFields({
        targetAuthorPubkey,
        targetAuthorLabel,
        candidateTopics,
        allowRemember,
        rememberLabel,
      }),
      el('row', { className: 'web-form__actions', gap: 'xs' }, [
        el(
          'button',
          {
            label: createLabel,
            htmlType: 'submit',
            submitAction: withSignalReviewDefaults({
              action: createAction,
              outcome: 'create',
            }),
          },
          [],
        ),
        ...(withoutSignalLabel && withoutSignalAction
          ? [
              el(
                'button',
                {
                  label: withoutSignalLabel,
                  htmlType: 'submit',
                  submitAction: withSignalReviewDefaults({
                    action: withoutSignalAction,
                    outcome: 'without_signal',
                  }),
                },
                [],
              ),
            ]
          : []),
        ...(cancelAction
          ? [el('button', { label: 'Cancel', action: cancelAction }, [])]
          : []),
      ]),
    ],
  );
}

export function renderSignalReviewRoot(
  props: SignalReviewFormProps,
): WebNodeRoot {
  return {
    kind: 'ui',
    version: 1,
    meta: { command: 'nr', subcommand: 'signal-review' },
    stylesheets: [signalReviewStylesheet],
    shadowMountOverflow: 'hidden',
    tree: renderSignalReviewForm(props),
  };
}
