import type { JsonNode } from './json-parser';

/** 从 JSON 字符串节点中提取可安全交给外部浏览器的 URL。 */
export function externalUrlFromNode(node: JsonNode): string | null {
  if (node.type !== 'string' || typeof node.value !== 'string') return null;
  const value = node.value.trim();
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}
