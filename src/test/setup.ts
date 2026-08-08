import '@testing-library/jest-dom/vitest';

// jsdom 没有实现 Range.getClientRects / getBoundingClientRect，
// 而 CodeMirror 在 requestAnimationFrame 里做文本尺寸测量时会调用它们，
// 导致渲染 JsonEditor 的测试抛出未捕获错误（不影响断言，但会污染输出并可能变得不稳定）。
// 这里补上最小实现，仅为让测量路径能安全走完。
if (typeof Range !== 'undefined') {
  const emptyRect: DOMRect = {
    x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0,
    toJSON: () => ({}),
  };
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = function getClientRects() {
      return Object.assign([], { item: () => null, length: 0 }) as unknown as DOMRectList;
    };
  }
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = () => emptyRect;
  }
}
