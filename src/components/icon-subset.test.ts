import { brotliDecompressSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ICON_CODEPOINTS } from './Icon';

const knownWoff2Tags = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ',
  'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS',
  'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc',
  'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop',
  'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
];

function readBase128(data: Uint8Array, cursor: { offset: number }) {
  let value = 0;
  for (let index = 0; index < 5; index += 1) {
    const byte = data[cursor.offset++];
    if (byte === undefined) throw new Error('WOFF2 table directory 截断');
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) return value;
  }
  throw new Error('WOFF2 Base128 数值过长');
}

function readCmap(font: Uint8Array) {
  if (String.fromCharCode(...font.subarray(0, 4)) !== 'wOF2') throw new Error('图标字体不是 WOFF2');
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const tableCount = view.getUint16(12);
  const compressedSize = view.getUint32(20);
  const cursor = { offset: 48 };
  const tables: Array<{ tag: string; length: number }> = [];
  for (let index = 0; index < tableCount; index += 1) {
    const flags = font[cursor.offset++];
    const tagIndex = flags & 0x3f;
    const transformVersion = flags >> 6;
    const tag = tagIndex === 0x3f
      ? String.fromCharCode(...font.subarray(cursor.offset, cursor.offset += 4))
      : knownWoff2Tags[tagIndex];
    const originalLength = readBase128(font, cursor);
    const transformed = tag === 'glyf' || tag === 'loca' ? transformVersion !== 3 : transformVersion !== 0;
    tables.push({ tag, length: transformed ? readBase128(font, cursor) : originalLength });
  }

  let decompressed: Uint8Array | undefined;
  for (let start = cursor.offset; start <= cursor.offset + 3; start += 1) {
    try {
      const candidate = brotliDecompressSync(font.subarray(start, start + compressedSize));
      if (candidate.length === tables.reduce((total, table) => total + table.length, 0)) {
        decompressed = candidate;
        break;
      }
    } catch {
      // 尝试下一个可能的 Brotli 起始位置。
    }
  }
  if (!decompressed) throw new Error('无法解压图标字体');

  const cmapTable = tables.find((table) => table.tag === 'cmap');
  if (!cmapTable) throw new Error('图标字体缺少 cmap table');
  const tableOffset = tables.slice(0, tables.indexOf(cmapTable)).reduce((total, table) => total + table.length, 0);
  const cmap = decompressed.subarray(tableOffset, tableOffset + cmapTable.length);
  const cmapView = new DataView(cmap.buffer, cmap.byteOffset, cmap.byteLength);
  const subtables = cmapView.getUint16(2);
  const codepoints = new Set<number>();

  for (let index = 0; index < subtables; index += 1) {
    const record = 4 + index * 8;
    const offset = cmapView.getUint32(record + 4);
    const format = cmapView.getUint16(offset);
    if (format === 4) {
      const segments = cmapView.getUint16(offset + 6) / 2;
      const endCodes = offset + 14;
      const startCodes = endCodes + segments * 2 + 2;
      const deltas = startCodes + segments * 2;
      const rangeOffsets = deltas + segments * 2;
      for (let segment = 0; segment < segments; segment += 1) {
        const start = cmapView.getUint16(startCodes + segment * 2);
        const end = cmapView.getUint16(endCodes + segment * 2);
        const delta = cmapView.getInt16(deltas + segment * 2);
        const rangeOffset = cmapView.getUint16(rangeOffsets + segment * 2);
        for (let codepoint = start; codepoint <= end; codepoint += 1) {
          const glyphId = rangeOffset === 0
            ? (codepoint + delta) & 0xffff
            : cmapView.getUint16(rangeOffsets + segment * 2 + rangeOffset + (codepoint - start) * 2);
          if (glyphId !== 0) codepoints.add(codepoint);
        }
      }
    } else if (format === 12) {
      const groups = cmapView.getUint32(offset + 12);
      for (let group = 0; group < groups; group += 1) {
        const groupOffset = offset + 16 + group * 12;
        const start = cmapView.getUint32(groupOffset);
        const end = cmapView.getUint32(groupOffset + 4);
        for (let codepoint = start; codepoint <= end; codepoint += 1) codepoints.add(codepoint);
      }
    }
  }
  return codepoints;
}

const fontPath = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/fonts/MaterialSymbolsOutlined-subset.woff2');

describe('Material Symbols 图标子集', () => {
  it('cmap 包含映射表中的每个 codepoint', () => {
    const cmap = readCmap(readFileSync(fontPath));
    for (const [name, value] of Object.entries(ICON_CODEPOINTS)) {
      const codepoint = Number.parseInt(value, 16);
      expect(cmap.has(codepoint), `${name} (${value})`).toBe(true);
    }
    expect(cmap.size).toBe(Object.keys(ICON_CODEPOINTS).length);
  });

  it('显式拒绝重复 codepoint，避免重复映射被静默忽略', () => {
    const namesByCodepoint = new Map<string, string[]>();
    for (const [name, codepoint] of Object.entries(ICON_CODEPOINTS)) {
      const names = namesByCodepoint.get(codepoint) ?? [];
      names.push(name);
      namesByCodepoint.set(codepoint, names);
    }
    const duplicates = [...namesByCodepoint.values()].filter((names) => names.length > 1);
    expect(duplicates, '重复 codepoint 必须显式处理').toEqual([]);
  });
});
