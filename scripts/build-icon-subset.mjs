import { brotliDecompressSync } from 'node:zlib';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const iconSourcePath = join(root, 'src/components/Icon.tsx');
// 子集产物放 src/assets：需要 Vite 按内容出哈希文件名来破缓存，
// public/ 下文件名固定，改了内容浏览器仍用旧字体。
const outputPath = join(root, 'src/assets/fonts/MaterialSymbolsOutlined-subset.woff2');

const knownWoff2Tags = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ',
  'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS',
  'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc',
  'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop',
  'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
];

function fail(message) {
  console.error(`图标子集生成失败：${message}`);
  process.exitCode = 1;
}

function readMappings() {
  const source = readFileSync(iconSourcePath, 'utf8');
  const block = source.match(/export const ICON_CODEPOINTS\s*=\s*\{([\s\S]*?)\}\s*as const/);
  if (!block) throw new Error(`无法从 ${iconSourcePath} 读取 ICON_CODEPOINTS`);
  const entries = [...block[1].matchAll(/^\s*([A-Za-z0-9_]+):\s*['"]([0-9a-fA-F]+)['"]/gm)]
    .map(([, name, value]) => ({ name, value: Number.parseInt(value, 16) }));
  if (!entries.length) throw new Error('ICON_CODEPOINTS 为空或格式无法识别');
  const namesByCodepoint = new Map();
  for (const entry of entries) {
    const names = namesByCodepoint.get(entry.value) ?? [];
    names.push(entry.name);
    namesByCodepoint.set(entry.value, names);
  }
  const duplicates = [...namesByCodepoint.entries()].filter(([, names]) => names.length > 1);
  if (duplicates.length) {
    throw new Error(`映射表存在重复 codepoint：${duplicates.map(([value, names]) => `0x${value.toString(16)} (${names.join(', ')})`).join('；')}`);
  }
  return { entries, codepoints: [...namesByCodepoint.keys()] };
}

function findFontSource() {
  const candidates = [
    process.env.MATERIAL_SYMBOLS_FONT,
    join(root, 'public/fonts/MaterialSymbolsOutlined-full.woff2'),
    join(root, 'assets/fonts/MaterialSymbolsOutlined-full.woff2'),
    '/private/tmp/MaterialSymbolsOutlined-full.woff2',
    join(homedir(), 'Library/Caches/MaterialSymbolsOutlined-full.woff2'),
  ].filter(Boolean);
  const source = candidates.find((candidate) => existsSync(candidate));
  if (!source) {
    throw new Error('找不到完整 Material Symbols 字体；请设置 MATERIAL_SYMBOLS_FONT 指向 .woff2 源文件（完整源字体不入库）');
  }
  return source;
}

function findPyftsubset() {
  const candidates = [
    process.env.PYFTSUBSET,
    'pyftsubset',
    '/private/tmp/fonttools-venv/bin/pyftsubset',
  ].filter(Boolean);
  for (const command of candidates) {
    const result = spawnSync(command, ['--help'], { encoding: 'utf8' });
    if (!result.error && result.status === 0) return command;
  }
  throw new Error('找不到 pyftsubset；请先执行 pip install fonttools');
}

function readBase128(data, cursor) {
  let value = 0;
  for (let index = 0; index < 5; index += 1) {
    const byte = data[cursor.offset++];
    if (byte === undefined) throw new Error('WOFF2 table directory 截断');
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) return value;
  }
  throw new Error('WOFF2 Base128 数值过长');
}

function readWoff2Cmap(data) {
  if (String.fromCharCode(...data.subarray(0, 4)) !== 'wOF2') throw new Error('输出文件不是 WOFF2');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const numTables = view.getUint16(12);
  const compressedSize = view.getUint32(20);
  const cursor = { offset: 48 };
  const tables = [];
  for (let index = 0; index < numTables; index += 1) {
    const flags = data[cursor.offset++];
    const tagIndex = flags & 0x3f;
    const transformVersion = flags >> 6;
    const tag = tagIndex === 0x3f
      ? String.fromCharCode(...data.subarray(cursor.offset, cursor.offset += 4))
      : knownWoff2Tags[tagIndex];
    if (!tag) throw new Error(`未知 WOFF2 table tag index ${tagIndex}`);
    const originalLength = readBase128(data, cursor);
    const transformed = tag === 'glyf' || tag === 'loca' ? transformVersion !== 3 : transformVersion !== 0;
    const length = transformed ? readBase128(data, cursor) : originalLength;
    tables.push({ tag, length });
  }

  let decompressed;
  for (let start = cursor.offset; start <= cursor.offset + 3; start += 1) {
    try {
      const candidate = brotliDecompressSync(data.subarray(start, start + compressedSize));
      if (candidate.length === tables.reduce((total, table) => total + table.length, 0)) {
        decompressed = candidate;
        break;
      }
    } catch {
      // 某些字体生成器会在 Brotli 数据前留少量填充，继续尝试下一个字节。
    }
  }
  if (!decompressed) throw new Error('无法解压 WOFF2 table 数据');

  let tableOffset = 0;
  const cmapTable = tables.find((table) => table.tag === 'cmap');
  for (const table of tables) {
    if (table === cmapTable) break;
    tableOffset += table.length;
  }
  if (!cmapTable) throw new Error('WOFF2 中没有 cmap table');
  return parseCmap(decompressed.subarray(tableOffset, tableOffset + cmapTable.length));
}

function parseCmap(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const numTables = view.getUint16(2);
  const codepoints = new Set();
  for (let index = 0; index < numTables; index += 1) {
    const recordOffset = 4 + index * 8;
    const subtableOffset = view.getUint32(recordOffset + 4);
    const format = view.getUint16(subtableOffset);
    if (format === 4) {
      const segments = view.getUint16(subtableOffset + 6) / 2;
      const endCodes = subtableOffset + 14;
      const startCodes = endCodes + segments * 2 + 2;
      const deltas = startCodes + segments * 2;
      const rangeOffsets = deltas + segments * 2;
      for (let segment = 0; segment < segments; segment += 1) {
        const start = view.getUint16(startCodes + segment * 2);
        const end = view.getUint16(endCodes + segment * 2);
        const delta = view.getInt16(deltas + segment * 2);
        const rangeOffset = view.getUint16(rangeOffsets + segment * 2);
        for (let codepoint = start; codepoint <= end; codepoint += 1) {
          const glyphId = rangeOffset === 0
            ? (codepoint + delta) & 0xffff
            : view.getUint16(rangeOffsets + segment * 2 + rangeOffset + (codepoint - start) * 2);
          if (glyphId !== 0) codepoints.add(codepoint);
        }
      }
    } else if (format === 12) {
      const groups = view.getUint32(subtableOffset + 12);
      for (let group = 0; group < groups; group += 1) {
        const groupOffset = subtableOffset + 16 + group * 12;
        const start = view.getUint32(groupOffset);
        const end = view.getUint32(groupOffset + 4);
        for (let codepoint = start; codepoint <= end; codepoint += 1) codepoints.add(codepoint);
      }
    }
  }
  return codepoints;
}

try {
  const { entries, codepoints } = readMappings();
  const source = findFontSource();
  const pyftsubset = findPyftsubset();
  const unicodeArgument = codepoints.map((codepoint) => `U+${codepoint.toString(16).toUpperCase()}`).join(',');
  const result = spawnSync(pyftsubset, [
    source,
    `--output-file=${outputPath}`,
    '--flavor=woff2',
    `--unicodes=${unicodeArgument}`,
    '--layout-features=*',
    '--glyph-names',
    '--symbol-cmap',
    '--legacy-cmap',
  ], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'pyftsubset 未知错误').trim());
  }
  const generatedCodepoints = readWoff2Cmap(readFileSync(outputPath));
  const missing = codepoints.filter((codepoint) => !generatedCodepoints.has(codepoint));
  if (missing.length) throw new Error(`生成结果缺少 codepoint：${missing.map((codepoint) => `0x${codepoint.toString(16)}`).join(', ')}`);
  console.log(`字形数 ${generatedCodepoints.size}，映射表 ${entries.length} 项`);
  if (generatedCodepoints.size !== entries.length) throw new Error('字形数与映射表项数不一致');
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
