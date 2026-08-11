import { describe, expect, it } from 'vitest';
import { parseJson } from './json-parser';
import { externalUrlFromNode } from './json-url';

describe('externalUrlFromNode', () => {
  it('只接受 http 和 https 字符串', () => {
    expect(externalUrlFromNode(parseJson('"http://a.com"'))).toBe('http://a.com');
    expect(externalUrlFromNode(parseJson('" HTTPS://a.com/x?y=1#z "'))).toBe('HTTPS://a.com/x?y=1#z');
  });

  it('拒绝危险协议、协议相对地址和非字符串节点', () => {
    for (const value of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,<script>',
      'vbscript:alert(1)',
      'about:blank',
      'blob:https://a.com/id',
      '//evil.com/path',
    ]) {
      expect(externalUrlFromNode(parseJson(JSON.stringify(value))), value).toBeNull();
    }
    expect(externalUrlFromNode(parseJson('42'))).toBeNull();
    expect(externalUrlFromNode(parseJson('null'))).toBeNull();
  });
});
