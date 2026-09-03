import type { WebNode } from '@src/web/ui-schema';

export type WebElementTag = Extract<WebNode, { type: 'element' }>['tag'];

export function text(value: string): WebNode {
  return { type: 'text', value };
}

export function el(
  tag: WebElementTag,
  props: Record<string, unknown>,
  children: WebNode[],
): WebNode {
  return { type: 'element', tag, props, children } as WebNode;
}

export function keyed(renderKey: string, node: WebNode): WebNode {
  return node.type === 'element' ? { ...node, renderKey } : node;
}

export function entityKey(eventId: string): string {
  return `nostr-event:${eventId}`;
}

export function tagGroupEntityKey(
  type: 'topic' | 'mood' | 'language',
  tag: string,
): string {
  return `nr-${type}:${tag}`;
}
