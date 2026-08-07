import type { JsonDocument } from '../types';

export function isCurrentDocumentSnapshot(
  documents: readonly JsonDocument[],
  documentId: string,
  source: string,
): boolean {
  return documents.some((document) => document.id === documentId && document.content === source);
}
