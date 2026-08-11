import { describe, expect, it, vi } from 'vitest';
import { destroyAppWindow, shouldConfirmAppClose, transformBlockedReason } from './App';

// 回归背景:历史视图下点「转义字符串」曾提示「Diff 模式下已禁用内容变换」。
// 原因是守卫判了 diff || historyOpen，但提示文案硬编码成 Diff，
// 且「更多」菜单的 disabled 只判了 diff，导致历史视图下菜单项仍可点击。
// 现在三处（工具栏 tooltip、菜单 disabled、点击后的 toast）共用本函数。
describe('transformBlockedReason', () => {
  it('可执行时返回 null', () => {
    expect(transformBlockedReason(null, false, false)).toBeNull();
  });

  it('历史视图下的文案指向历史视图，不能说成 Diff', () => {
    const reason = transformBlockedReason(null, true, false);
    expect(reason).toContain('历史视图');
    expect(reason).not.toContain('Diff');
  });

  it('Diff 模式下的文案指向 Diff', () => {
    const reason = transformBlockedReason({ leftId: 'a', rightId: 'b' }, false, false);
    expect(reason).toContain('Diff');
    expect(reason).not.toContain('历史视图');
  });

  it('历史视图与 Diff 同时成立时优先报历史视图（用户当前所见的那个）', () => {
    expect(transformBlockedReason({ leftId: 'a', rightId: 'b' }, true, false)).toContain('历史视图');
  });

  it('仅处理中时给出处理中的提示，而不是视图类文案', () => {
    const reason = transformBlockedReason(null, false, true);
    expect(reason).toContain('处理');
    expect(reason).not.toContain('Diff');
    expect(reason).not.toContain('历史视图');
  });

  it('三种阻塞状态的文案互不相同，避免张冠李戴', () => {
    const reasons = [
      transformBlockedReason(null, true, false),
      transformBlockedReason({ leftId: 'a', rightId: 'b' }, false, false),
      transformBlockedReason(null, false, true),
    ];
    expect(new Set(reasons).size).toBe(3);
  });
});

describe('shouldConfirmAppClose', () => {
  it('可完整恢复时有脏文档也直接退出', () => {
    expect(shouldConfirmAppClose(true, true, { ok: true, recoverable: true })).toBe(false);
  });

  it('无脏文档时不因快照失败阻止退出', () => {
    expect(shouldConfirmAppClose(false, true, { ok: false, recoverable: false })).toBe(false);
  });

  it('关闭恢复或写入失败且有脏文档时确认', () => {
    expect(shouldConfirmAppClose(true, false, { ok: true, recoverable: false })).toBe(true);
    expect(shouldConfirmAppClose(true, true, { ok: false, recoverable: false })).toBe(true);
  });
});

it('确认退出后直接销毁窗口，不再触发 closeRequested', async () => {
  const destroy = vi.fn(async () => undefined);
  const close = vi.fn(async () => undefined);
  const appWindow = { destroy, close };
  await destroyAppWindow(appWindow);
  expect(destroy).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
});
