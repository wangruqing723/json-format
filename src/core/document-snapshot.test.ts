import { describe, expect, it } from 'vitest';
import type { JsonDocument } from '../types';
import { isCurrentDocumentSnapshot } from './document-snapshot';

const document: JsonDocument = {
  id: 'document-1',
  title: 'data.json',
  filePath: null,
  content: '{"value":1}',
  savedContent: '',
  collapsedPane: 'none',
  language: 'json',
  createdAt: 1,
  updatedAt: 1,
};

describe('isCurrentDocumentSnapshot', () => {
  it('仅在目标文档仍存在且内容未变化时接受后台结果', () => {
    expect(isCurrentDocumentSnapshot([document], document.id, document.content)).toBe(true);
    expect(isCurrentDocumentSnapshot([{ ...document, content: '{"value":2}' }], document.id, document.content)).toBe(false);
    expect(isCurrentDocumentSnapshot([], document.id, document.content)).toBe(false);
  });
});
