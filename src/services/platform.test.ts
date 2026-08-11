import { describe, expect, it } from 'vitest';
import { isExternalUrl } from './platform';

describe('isExternalUrl', () => {
  it('只接受可解析的 http/https 地址', () => {
    expect(isExternalUrl('http://a.com')).toBe(true);
    expect(isExternalUrl('https://a.com/x?y=1#z')).toBe(true);
    expect(isExternalUrl('  HTTPS://a.com  ')).toBe(true);
  });

  it('拒绝非白名单协议和协议相对地址', () => {
    for (const value of [
      'javascript:alert(1)', '  JavaScript:alert(1)  ', 'file:///etc/passwd',
      'data:text/html,<script>', 'vbscript:alert(1)', 'about:blank',
      'blob:https://a.com/id', '//evil.com',
    ]) expect(isExternalUrl(value), value).toBe(false);
  });
});
