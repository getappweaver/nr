import { createHash, randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Database } from 'bun:sqlite';

import { getOutputString } from '@src/backends/types';
import type { PluginAgentService } from '@src/core/plugin';

import type { NostrEvent } from './commands/shared/types';
import {
  getNrImageCache,
  listNrEventImages,
  saveNrEventImage,
  saveNrImageCache,
} from './db';
import { nrImageAgentSelection, type NrSettings } from './settings';

type PreparedImage = {
  tempPath: string;
  mime: string;
  bytes: Uint8Array;
  hash: string;
  sourceUrl: string;
};

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif)(\?.*)?$/i;
const CONTENT_URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

const DATA_IMAGE_RE =
  /data:image\/(png|jpe?g|gif|webp|avif);base64,[A-Za-z0-9+/=\s]+/gi;

function mimeToExt(mime: string): string {
  const normalized = mime.toLowerCase().split(';')[0]!.trim();

  if (normalized === 'image/png') {
    return 'png';
  }

  if (normalized === 'image/gif') {
    return 'gif';
  }

  if (normalized === 'image/webp') {
    return 'webp';
  }

  if (normalized === 'image/avif') {
    return 'avif';
  }

  return 'jpg';
}

function extractImetaUrls(event: NostrEvent): string[] {
  const urls: string[] = [];

  for (const tag of event.tags) {
    if (tag[0] !== 'imeta' || tag.length < 2) {
      continue;
    }

    let url: string | null = null;
    let mime: string | null = null;

    for (const entry of tag.slice(1)) {
      const [key, ...rest] = entry.split(' ');
      const value = rest.join(' ').trim();

      if (key === 'url' && value) {
        url = value;
      }

      if (key === 'm' && value) {
        mime = value;
      }
    }

    if (url && (!mime || mime.toLowerCase().startsWith('image/'))) {
      urls.push(url);
    }
  }

  return urls;
}

function extractImageSources(event: NostrEvent): string[] {
  const seen = new Set<string>();
  const sources: string[] = [];

  const push = (source: string): void => {
    const normalized = source.trim();

    if (!normalized || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    sources.push(normalized);
  };

  for (const url of extractImetaUrls(event)) {
    push(url);
  }

  for (const match of event.content.matchAll(CONTENT_URL_RE)) {
    const url = match[0].replace(/[.,;:!?]+$/, '');

    if (IMAGE_EXT_RE.test(url)) {
      push(url);
    }
  }

  for (const match of event.content.matchAll(DATA_IMAGE_RE)) {
    push(match[0].replace(/\s+/g, ''));
  }

  return sources;
}

function parseDataImage(source: string): { mime: string; bytes: Uint8Array } {
  const comma = source.indexOf(',');
  const header = source.slice(0, comma);
  const mime = header.slice('data:'.length, header.indexOf(';'));
  const bytes = Buffer.from(source.slice(comma + 1), 'base64');

  return { mime, bytes: new Uint8Array(bytes) };
}

async function downloadHttpImage({
  url,
  timeoutMs,
  maxBytes,
}: {
  url: string;
  timeoutMs: number;
  maxBytes: number;
}): Promise<{ mime: string; bytes: Uint8Array } | null> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  }).catch(() => null);

  if (!response || !response.ok) {
    return null;
  }

  const mime =
    response.headers.get('content-type')?.split(';')[0]!.trim() ?? '';

  if (!mime.toLowerCase().startsWith('image/')) {
    return null;
  }

  const bytes = new Uint8Array(await response.arrayBuffer());

  if (bytes.length === 0 || bytes.length > maxBytes) {
    return null;
  }

  return { mime, bytes };
}

async function prepareImage({
  source,
  settings,
}: {
  source: string;
  settings: NrSettings;
}): Promise<PreparedImage | null> {
  const timeoutMs = Math.max(1, settings.imageFetchTimeoutSec) * 1000;

  const fetched = source.startsWith('data:image/')
    ? parseDataImage(source)
    : await downloadHttpImage({
        url: source,
        timeoutMs,
        maxBytes: settings.maxImageBytes,
      });

  if (!fetched || fetched.bytes.length > settings.maxImageBytes) {
    return null;
  }

  const hash = createHash('sha256').update(fetched.bytes).digest('hex');
  const dir = join(tmpdir(), 'nr-images');

  await mkdir(dir, { recursive: true });

  const tempPath = join(dir, `nr-${randomUUID()}.${mimeToExt(fetched.mime)}`);

  await writeFile(tempPath, fetched.bytes);

  return {
    tempPath,
    mime: fetched.mime,
    bytes: fetched.bytes,
    hash,
    sourceUrl:
      source.length > 500 ? `${source.slice(0, 200)}…(data-uri)` : source,
  };
}

async function cleanup(paths: string[]): Promise<void> {
  await Promise.all(paths.map((path) => unlink(path).catch(() => null)));
}

function parseVisionDescriptions(raw: string, count: number): string[] {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidate = fenced ?? trimmed;

  try {
    const parsed = JSON.parse(candidate) as {
      descriptions?: unknown;
      description?: unknown;
    };

    const values = Array.isArray(parsed.descriptions)
      ? parsed.descriptions
      : parsed.description !== undefined
        ? [parsed.description]
        : [];

    const descriptions = values
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);

    if (descriptions.length > 0) {
      return descriptions.slice(0, count);
    }
  } catch {
    // Fall through to plain-text handling below.
  }

  const lines = trimmed
    .split('\n')
    .map((line) => line.replace(/^[-*\d.)\s]+/, '').trim())
    .filter(Boolean);

  return (lines.length > 0 ? lines : [trimmed]).slice(0, count);
}

type DescribeImagesProps = {
  db: Database;
  event: NostrEvent;
  settings: NrSettings;
  agent: PluginAgentService;
  abortSignal: AbortSignal | null;
};

export async function describeEventImages({
  db,
  event,
  settings,
  agent,
  abortSignal,
}: DescribeImagesProps): Promise<string[]> {
  if (!settings.evaluateImages) {
    return [];
  }

  if (abortSignal?.aborted) {
    return [];
  }

  const cachedLinks = listNrEventImages(db, event.id);

  if (cachedLinks.length > 0) {
    const descriptions: string[] = [];

    for (const link of cachedLinks) {
      const entry = getNrImageCache(db, link.imageHash);

      if (entry) {
        descriptions.push(entry.description);
      }
    }

    if (descriptions.length > 0) {
      return descriptions;
    }
  }

  const sources = extractImageSources(event).slice(
    0,
    Math.max(1, settings.maxImagesPerEvent),
  );

  if (sources.length === 0) {
    return [];
  }

  const prepared: PreparedImage[] = [];

  try {
    for (const source of sources) {
      if (abortSignal?.aborted) {
        break;
      }

      const image = await prepareImage({ source, settings }).catch(() => null);

      if (image) {
        prepared.push(image);
      }
    }

    if (prepared.length === 0) {
      return [];
    }

    const uncached = prepared.filter(
      (image) => !getNrImageCache(db, image.hash),
    );

    if (uncached.length > 0) {
      const imageAgent = nrImageAgentSelection(settings);

      const prompt = [
        'Describe each attached local image file for Nostr post classification.',
        'Use the Read tool on each file path below. Do NOT use a browser, web fetch, or Chrome.',
        'Return ONLY JSON with this shape: { "descriptions": ["one concise visual description per file, in order"] }',
        'Each description: what is depicted, any visible people/objects/scene, and key text if present. No topic judgments.',
        '',
        ...uncached.map(
          (image, index) => `Image ${index + 1}: ${image.tempPath}`,
        ),
      ].join('\n');

      const result = await agent.run({
        prompt,
        sessionId: null,
        backend: imageAgent.backend,
        provider: null,
        model: imageAgent.model,
        mode: null,
        workspaceTarget: null,
        cwd: null,
        onAgentStreamChunk: null,
        abortSignal,
        context: null,
      });

      if (result.type !== 'error') {
        const descriptions = parseVisionDescriptions(
          getOutputString(result),
          uncached.length,
        );

        uncached.forEach((image, index) => {
          const description = descriptions[index]?.trim();

          if (description) {
            saveNrImageCache({
              db,
              imageHash: image.hash,
              mime: image.mime,
              byteSize: image.bytes.length,
              description,
              model: result.model ?? result.backend,
            });
          }
        });
      }
    }

    const descriptions: string[] = [];

    for (const image of prepared) {
      saveNrEventImage({
        db,
        eventId: event.id,
        imageHash: image.hash,
        sourceUrl: image.sourceUrl,
      });

      const entry = getNrImageCache(db, image.hash);

      if (entry) {
        descriptions.push(entry.description);
      }
    }

    return descriptions;
  } finally {
    await cleanup(prepared.map((image) => image.tempPath));
  }
}
