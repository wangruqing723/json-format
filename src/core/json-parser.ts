import type { JsonDiagnostic } from '../types';

export type JsonNode = JsonObjectNode | JsonArrayNode | JsonPrimitiveNode;

export interface JsonObjectEntry {
  key: string;
  keyRaw: string;
  keyOffset: number;
  value: JsonNode;
  index: number;
}

export interface JsonObjectNode {
  type: 'object';
  entries: JsonObjectEntry[];
  offset: number;
}

export interface JsonArrayNode {
  type: 'array';
  items: JsonNode[];
  offset: number;
}

export interface JsonPrimitiveNode {
  type: 'string' | 'number' | 'boolean' | 'null';
  raw: string;
  value?: string | boolean | null;
  offset: number;
}

export class JsonParseError extends Error {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super(message);
    this.name = 'JsonParseError';
    this.offset = offset;
  }
}

class Parser {
  private position = 0;

  constructor(private readonly source: string) {}

  parse(): JsonNode {
    this.skipWhitespace();
    if (this.position >= this.source.length) {
      throw new JsonParseError('JSON 内容为空', 0);
    }

    const result = this.parseValue();
    this.skipWhitespace();
    if (this.position !== this.source.length) {
      throw new JsonParseError('JSON 值后存在多余内容', this.position);
    }
    return result;
  }

  private parseValue(): JsonNode {
    const character = this.source[this.position];
    if (character === '{') return this.parseObject();
    if (character === '[') return this.parseArray();
    if (character === '"') return this.parseStringNode();
    if (character === '-' || this.isDigit(character)) return this.parseNumber();
    if (character === 't') return this.parseLiteral('true', 'boolean', true);
    if (character === 'f') return this.parseLiteral('false', 'boolean', false);
    if (character === 'n') return this.parseLiteral('null', 'null', null);

    throw new JsonParseError(
      character === undefined ? 'JSON 值不完整' : `无法识别的字符“${character}”`,
      this.position,
    );
  }

  private parseObject(): JsonObjectNode {
    const offset = this.position++;
    const entries: JsonObjectEntry[] = [];
    this.skipWhitespace();
    if (this.consume('}')) return { type: 'object', entries, offset };

    while (this.position < this.source.length) {
      if (this.source[this.position] !== '"') {
        throw new JsonParseError('对象键必须是双引号字符串', this.position);
      }
      const keyOffset = this.position;
      const keyNode = this.parseStringNode();
      this.skipWhitespace();
      if (!this.consume(':')) {
        throw new JsonParseError('对象键后缺少冒号', this.position);
      }
      this.skipWhitespace();
      const value = this.parseValue();
      entries.push({
        key: keyNode.value as string,
        keyRaw: keyNode.raw,
        keyOffset,
        value,
        index: entries.length,
      });
      this.skipWhitespace();
      if (this.consume('}')) return { type: 'object', entries, offset };
      if (!this.consume(',')) {
        throw new JsonParseError('对象成员之间缺少逗号', this.position);
      }
      this.skipWhitespace();
      if (this.source[this.position] === '}') {
        throw new JsonParseError('对象末尾不允许多余逗号', this.position);
      }
    }

    throw new JsonParseError('对象缺少右花括号', this.source.length);
  }

  private parseArray(): JsonArrayNode {
    const offset = this.position++;
    const items: JsonNode[] = [];
    this.skipWhitespace();
    if (this.consume(']')) return { type: 'array', items, offset };

    while (this.position < this.source.length) {
      items.push(this.parseValue());
      this.skipWhitespace();
      if (this.consume(']')) return { type: 'array', items, offset };
      if (!this.consume(',')) {
        throw new JsonParseError('数组元素之间缺少逗号', this.position);
      }
      this.skipWhitespace();
      if (this.source[this.position] === ']') {
        throw new JsonParseError('数组末尾不允许多余逗号', this.position);
      }
    }

    throw new JsonParseError('数组缺少右方括号', this.source.length);
  }

  private parseStringNode(): JsonPrimitiveNode {
    const offset = this.position;
    this.position++;
    while (this.position < this.source.length) {
      const character = this.source[this.position];
      if (character === '"') {
        this.position++;
        const raw = this.source.slice(offset, this.position);
        return { type: 'string', raw, value: JSON.parse(raw) as string, offset };
      }
      if (character === '\\') {
        const escapeOffset = this.position;
        this.position++;
        const escaped = this.source[this.position];
        if (escaped === 'u') {
          const hex = this.source.slice(this.position + 1, this.position + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            throw new JsonParseError('Unicode 转义必须包含四位十六进制数字', escapeOffset);
          }
          this.position += 5;
          continue;
        }
        if (!escaped || !'"\\/bfnrt'.includes(escaped)) {
          throw new JsonParseError('字符串包含无效转义', escapeOffset);
        }
        this.position++;
        continue;
      }
      if (character.charCodeAt(0) <= 0x1f) {
        throw new JsonParseError('字符串中不能包含未转义的控制字符', this.position);
      }
      this.position++;
    }
    throw new JsonParseError('字符串缺少结束双引号', this.source.length);
  }

  private parseNumber(): JsonPrimitiveNode {
    const offset = this.position;
    if (this.consume('-') && !this.isDigit(this.source[this.position])) {
      throw new JsonParseError('负号后必须是数字', this.position);
    }

    if (this.consume('0')) {
      if (this.isDigit(this.source[this.position])) {
        throw new JsonParseError('数字不能包含前导零', this.position);
      }
    } else {
      if (!this.isNonZeroDigit(this.source[this.position])) {
        throw new JsonParseError('数字的整数部分无效', this.position);
      }
      while (this.isDigit(this.source[this.position])) this.position++;
    }

    if (this.consume('.')) {
      if (!this.isDigit(this.source[this.position])) {
        throw new JsonParseError('小数点后必须包含数字', this.position);
      }
      while (this.isDigit(this.source[this.position])) this.position++;
    }

    if (this.source[this.position] === 'e' || this.source[this.position] === 'E') {
      this.position++;
      if (this.source[this.position] === '+' || this.source[this.position] === '-') {
        this.position++;
      }
      if (!this.isDigit(this.source[this.position])) {
        throw new JsonParseError('指数部分必须包含数字', this.position);
      }
      while (this.isDigit(this.source[this.position])) this.position++;
    }

    return { type: 'number', raw: this.source.slice(offset, this.position), offset };
  }

  private parseLiteral(
    literal: 'true' | 'false' | 'null',
    type: 'boolean' | 'null',
    value: boolean | null,
  ): JsonPrimitiveNode {
    const offset = this.position;
    if (this.source.slice(this.position, this.position + literal.length) !== literal) {
      throw new JsonParseError(`无效的 JSON 字面量，应为 ${literal}`, this.position);
    }
    this.position += literal.length;
    return { type, raw: literal, value, offset };
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.source[this.position] ?? '') && this.source[this.position] !== '\u00a0') {
      const code = this.source.charCodeAt(this.position);
      if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) break;
      this.position++;
    }
  }

  private consume(character: string): boolean {
    if (this.source[this.position] !== character) return false;
    this.position++;
    return true;
  }

  private isDigit(character: string | undefined): boolean {
    return character !== undefined && character >= '0' && character <= '9';
  }

  private isNonZeroDigit(character: string | undefined): boolean {
    return character !== undefined && character >= '1' && character <= '9';
  }
}

export function parseJson(source: string): JsonNode {
  return new Parser(source).parse();
}

export function diagnosticFromError(source: string, error: unknown): JsonDiagnostic {
  const offset = Math.max(
    0,
    Math.min(
      source.length,
      error instanceof JsonParseError ? error.offset : extractNativeOffset(error) ?? 0,
    ),
  );
  const before = source.slice(0, offset);
  const line = before.split('\n').length;
  const lastNewline = before.lastIndexOf('\n');
  const column = offset - lastNewline;
  const context = source.split(/\r?\n/)[line - 1];

  return {
    message: error instanceof Error ? error.message : '未知 JSON 处理错误',
    line,
    column,
    offset,
    code: error instanceof JsonParseError ? 'INVALID_JSON' : 'PROCESSING_ERROR',
    severity: 'error',
    ...(context === undefined ? {} : { context }),
  };
}

function extractNativeOffset(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined;
  const match = /(?:position|at position)\s+(\d+)/i.exec(error.message);
  return match ? Number(match[1]) : undefined;
}
