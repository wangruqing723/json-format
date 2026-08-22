import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// 树视图与编辑器对同一 JSON 类型必须用同一颜色，否则同一份数据在
// 文本视图和树视图会显示成两种颜色。历史上 styles.css 里曾有两组互相矛盾的
// 树视图取色，靠书写顺序侥幸生效，调整顺序就会静默回退到旧值。
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const editorSource = readFileSync(join(root, 'src/components/JsonEditor.tsx'), 'utf8');
const cssSource = readFileSync(join(root, 'src/styles.css'), 'utf8');

function editorPalette(which: string): Record<string, string> {
  const block = editorSource.match(new RegExp(`const ${which}Highlight[\\s\\S]*?\\]\\);`));
  if (!block) throw new Error(`未找到 ${which}Highlight 定义`);
  const out: Record<string, string> = {};
  for (const [, tag, color] of block[0].matchAll(/tags\.(\w+),\s*color:\s*'(#[0-9a-fA-F]{6})'/g)) {
    out[tag] = color.toLowerCase();
  }
  return out;
}

function treePalette(which: 'light' | 'dark'): Record<string, string> {
  const selector = which === 'dark' ? `:root\\[data-theme='dark'\\]` : `:root:not\\(\\[data-theme='dark'\\]\\)`;
  const out: Record<string, string> = {};
  // 规则体里除 color 外还可能有 font-style 等声明，因此只在花括号内抓 color
  const re = new RegExp(`${selector} \\.tree-value--(\\w+) \\{([^}]*)\\}`, 'g');
  for (const [, type, body] of cssSource.matchAll(re)) {
    const color = body.match(/color:\s*(#[0-9a-fA-F]{6})/);
    if (color) out[type] = color[1].toLowerCase();
  }
  return out;
}

// 编辑器 tag 名 → 树视图类型名
const PAIRS: Array<[string, string]> = [
  ['string', 'string'],
  ['number', 'number'],
  ['bool', 'boolean'],
  ['null', 'null'],
];

/** 树视图键名走 .tree-path 的 var(--accent)，取对应主题下该变量的值 */
function treeKeyColor(which: 'light' | 'dark'): string {
  const marker = which === 'dark' ? ":root[data-theme='dark'] {" : ':root {';
  const start = cssSource.indexOf(marker);
  const block = cssSource.slice(start, cssSource.indexOf('}', start));
  const m = block.match(/--accent:\s*(#[0-9a-fA-F]{6})/);
  if (!m) throw new Error(`未在 ${which} 主题下找到 --accent`);
  return m[1].toLowerCase();
}

describe('编辑器与树视图的类型配色一致性', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`${theme === 'light' ? '亮色' : '暗色'}下两处取色相同`, () => {
      const editor = editorPalette(theme);
      const tree = treePalette(theme);
      for (const [tag, type] of PAIRS) {
        expect(editor[tag], `编辑器缺少 ${tag} 的取色`).toBeTruthy();
        expect(tree[type], `树视图缺少 ${type} 的取色`).toBeTruthy();
        expect(tree[type], `${theme} 的 ${type}: 树视图 ${tree[type]} 与编辑器 ${editor[tag]} 不一致`)
          .toBe(editor[tag]);
      }
    });
  }

  // 输入法兼容模式的高亮把六种颜色抄了一遍，只去掉字重和斜体。抄一遍就会漂移：
  // 改了常规版的颜色而漏改这份，开启兼容模式后配色就与关闭时不同，而这一项
  // 用户开着的时候多半不会再去比对。故逐色钉死。
  for (const theme of ['light', 'dark'] as const) {
    it(`${theme === 'light' ? '亮色' : '暗色'}下兼容模式与常规模式配色逐项相同`, () => {
      const normal = editorPalette(theme);
      const flat = editorPalette(`${theme}Flat`);
      expect(Object.keys(flat).sort()).toEqual(Object.keys(normal).sort());
      for (const tag of Object.keys(normal)) {
        expect(flat[tag], `${theme} 的 ${tag}: 兼容模式 ${flat[tag]} 与常规 ${normal[tag]} 不一致`)
          .toBe(normal[tag]);
      }
    });
  }

  it('树视图取色只定义一处，不存在互相矛盾的重复规则', () => {
    for (const type of ['string', 'number', 'boolean', 'null']) {
      const darkHits = cssSource.match(
        new RegExp(`:root\\[data-theme='dark'\\] \\.tree-value--${type} \\{`, 'g'),
      );
      expect(darkHits?.length ?? 0, `.tree-value--${type} 的暗色规则出现了 ${darkHits?.length} 次`).toBe(1);
    }
  });

  // 用户实测发现过：树视图键名是粉色而编辑器是青色，同一份 JSON 在两个视图里
  // 键名颜色不同。键名是出现频率最高的 token，不一致最刺眼，故单列一条。
  for (const theme of ['light', 'dark'] as const) {
    it(`${theme === 'light' ? '亮色' : '暗色'}下键名颜色两处一致`, () => {
      expect(editorPalette(theme).propertyName).toBe(treeKeyColor(theme));
    });
  }

  // 编辑器里 "key": true 的键与值紧邻，同色就无法区分（树视图靠左右分栏掩盖了这点）
  for (const theme of ['light', 'dark'] as const) {
    it(`${theme === 'light' ? '亮色' : '暗色'}下键名与布尔不同色`, () => {
      const pal = editorPalette(theme);
      expect(pal.propertyName).not.toBe(pal.bool);
    });
  }

  it('亮暗两套的同一类型颜色不应相同（否则等于没有分主题）', () => {
    const light = editorPalette('light');
    const dark = editorPalette('dark');
    for (const [tag] of PAIRS) {
      expect(light[tag], `${tag} 在亮暗两套里是同一个值`).not.toBe(dark[tag]);
    }
  });
});
