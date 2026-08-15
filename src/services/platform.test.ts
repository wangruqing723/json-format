import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isExternalUrl, listenForJsonDrops } from './platform';

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  onDragDropEvent: vi.fn(),
  readTextFile: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauriMocks.invoke }));
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent: tauriMocks.onDragDropEvent }),
}));
vi.mock('@tauri-apps/plugin-fs', () => ({ readTextFile: tauriMocks.readTextFile }));

beforeEach(() => {
  window.__TAURI_INTERNALS__ = {};
  tauriMocks.invoke.mockReset();
  tauriMocks.onDragDropEvent.mockReset();
  tauriMocks.readTextFile.mockReset();
  tauriMocks.onDragDropEvent.mockResolvedValue(vi.fn());
});

afterEach(() => {
  delete window.__TAURI_INTERNALS__;
});

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

describe('listenForJsonDrops', () => {
  it('先放行路径，再只读取放行成功的 JSON 文件', async () => {
    const handler = vi.fn();
    const onError = vi.fn();
    tauriMocks.invoke.mockResolvedValue(['/tmp/allowed.JSON']);
    tauriMocks.readTextFile.mockResolvedValue('{"ok":true}');

    await listenForJsonDrops(handler, onError);
    const onDrop = tauriMocks.onDragDropEvent.mock.calls[0][0] as (event: unknown) => Promise<void>;
    await onDrop({
      payload: {
        type: 'drop',
        paths: ['/tmp/allowed.JSON', '/tmp/rejected.json', '/tmp/note.txt'],
      },
    });

    expect(tauriMocks.invoke).toHaveBeenCalledWith('allow_dropped_paths', {
      paths: ['/tmp/allowed.JSON', '/tmp/rejected.json'],
    });
    expect(tauriMocks.readTextFile).toHaveBeenCalledOnce();
    expect(tauriMocks.readTextFile).toHaveBeenCalledWith('/tmp/allowed.JSON');
    expect(handler).toHaveBeenCalledWith([{
      filePath: '/tmp/allowed.JSON',
      title: 'allowed.JSON',
      content: '{"ok":true}',
    }]);
    expect(onError).not.toHaveBeenCalled();
  });

  it('放行结果为空时通过 onError 报告失败', async () => {
    const handler = vi.fn();
    const onError = vi.fn();
    tauriMocks.invoke.mockResolvedValue([]);

    await listenForJsonDrops(handler, onError);
    const onDrop = tauriMocks.onDragDropEvent.mock.calls[0][0] as (event: unknown) => Promise<void>;
    await onDrop({ payload: { type: 'drop', paths: ['/tmp/rejected.json'] } });

    expect(onError).toHaveBeenCalledOnce();
    expect(handler).not.toHaveBeenCalled();
    expect(tauriMocks.readTextFile).not.toHaveBeenCalled();
  });

  it('放行或读取异常时通过 onError 报告失败', async () => {
    const handler = vi.fn();
    const onError = vi.fn();
    const error = new Error('scope denied');
    tauriMocks.invoke.mockRejectedValue(error);

    await listenForJsonDrops(handler, onError);
    const onDrop = tauriMocks.onDragDropEvent.mock.calls[0][0] as (event: unknown) => Promise<void>;
    await onDrop({ payload: { type: 'drop', paths: ['/tmp/file.json'] } });

    expect(onError).toHaveBeenCalledWith(error);
    expect(handler).not.toHaveBeenCalled();
  });
});
