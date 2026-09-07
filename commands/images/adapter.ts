import type { WebNode, WebNodeRoot } from '@src/web/ui-schema';

import { listNrEventImageEvaluations } from '../../db';
import type { NrCommandAdapterParams } from '../../types/adapter-params';

import { el, text } from '../list/renderers/primitives';

function evaluationNodes(
  evaluations: ReturnType<typeof listNrEventImageEvaluations>,
): WebNode[] {
  if (evaluations.length === 0) {
    return [
      el('text', { tone: 'muted' }, [
        text('No cached image evaluations found for this event.'),
      ]),
    ];
  }

  return evaluations.map((evaluation, index) =>
    el('stack', { gap: 'xs' }, [
      el('text', { weight: 'semibold' }, [text(`Image ${index + 1}`)]),
      el('text', {}, [text(evaluation.description)]),
      el('text', { tone: 'muted', size: 'sm' }, [
        text(
          `${evaluation.mime} | ${evaluation.byteSize.toLocaleString()} bytes | ${evaluation.model}`,
        ),
      ]),
      ...(evaluation.sourceUrl.startsWith('http://') ||
      evaluation.sourceUrl.startsWith('https://')
        ? [
            el(
              'link',
              {
                href: evaluation.sourceUrl,
                external: true,
                size: 'sm',
              },
              [text('Open source image')],
            ),
          ]
        : []),
    ]),
  );
}

export function adaptImagesCommand(
  params: NrCommandAdapterParams,
): string | WebNodeRoot {
  const eventId = params.parsed.arguments.event_id;

  if (typeof eventId !== 'string' || !eventId.trim()) {
    return `Usage: ${params.prefix}${params.alias} images <event_id>`;
  }

  const evaluations = listNrEventImageEvaluations(params.db, eventId.trim());

  if (params.source !== 'web') {
    if (evaluations.length === 0) {
      return 'No cached image evaluations found for this event.';
    }

    return evaluations
      .map(
        (evaluation, index) =>
          `Image ${index + 1}: ${evaluation.description}\nSource: ${evaluation.sourceUrl}\nModel: ${evaluation.model}`,
      )
      .join('\n\n');
  }

  return {
    kind: 'ui',
    version: 1,
    meta: { command: params.alias, subcommand: 'images' },
    tree: el('stack', { gap: 'sm' }, evaluationNodes(evaluations)),
  };
}
