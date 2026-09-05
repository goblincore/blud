```typescript
// CSV Parser - handles RFC 4180 compliant parsing
// Supports: quoted fields, escaped quotes, newlines in fields, empty fields, trailing newlines

export function parseCsv(input: string): string[][] {
  const result: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotedField = false;
  let i = 0;

  while (i < input.length) {
    const char = input[i];

    if (inQuotedField) {
      if (char === '"') {
        // Check for escaped quote (double-double-quote)
        if (i + 1 < input.length && input[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        }
        // End of quoted field
        inQuotedField = false;
        i++;
        continue;
      }
      currentField += char;
      i++;
      continue;
    }

    // Not in quoted field
    if (char === '"') {
      inQuotedField = true;
      i++;
      continue;
    }

    if (char === ',') {
      currentRow.push(currentField);
      currentField = '';
      i++;
      continue;
    }

    if (char === '\n') {
      currentRow.push(currentField);
      currentField = '';
      i++;
      // Don't push row if we're at end of input (trailing newline)
      if (i < input.length) {
        result.push(currentRow);
        currentRow = [];
      } else {
        // Trailing newline - don't add empty row
        break;
      }
      continue;
    }

    if (char === '\r') {
      // Handle \r\n
      if (i + 1 < input.length && input[i + 1] === '\n') {
        currentRow.push(currentField);
        currentField = '';
        i += 2;
        if (i < input.length) {
          result.push(currentRow);
          currentRow = [];
        } else {
          break;
        }
        continue;
      }
      // Lone \r
      currentRow.push(currentField);
      currentField = '';
      i++;
      if (i < input.length) {
        result.push(currentRow);
        currentRow = [];
      } else {
        break;
      }
      continue;
    }

    // Regular character (including \n if not in quoted field - but that's handled above)
    currentField += char;
    i++;
  }

  // Handle last field/row if input didn't end with newline
  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField);
    result.push(currentRow);
  }

  return result;
}

export function serializeCsv(rows: string[][]): string {
  if (rows.length === 0) return '';

  return rows.map(row =>
    row.map(field => {
      // Escape double quotes by doubling them
      const escaped = field.replace(/"/g, '""');
      // Wrap in quotes if field contains comma, quote, or newline
      if (escaped.includes(',') || escaped.includes('"') || escaped.includes('\n') || escaped.includes('\r')) {
        return `"${escaped}"`;
      }
      return field;
    }).join(',')
  ).join('\n');
}

// ==================== TESTS ====================

import { describe, it, expect } from 'vitest';

describe('parseCsv', () => {
  it('parses simple fields', () => {
    expect(parseCsv('a,b,c')).toEqual([['a', 'b', 'c']]);
  });

  it('parses multiple rows', () => {
    expect(parseCsv('a,b\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('handles quoted fields', () => {
    expect(parseCsv('"hello","world"')).toEqual([['hello', 'world']]);
  });

  it('handles escaped quotes (double-double-quote)', () => {
    expect(parseCsv('"He said ""hello"" to her"')).toEqual([['He said "hello" to her']]);
  });

  it('handles newlines inside quoted fields', () => {
    expect(parseCsv('"hello\nworld","test"')).toEqual([['hello\nworld', 'test']]);
  });

  it('handles empty fields', () => {
    expect(parseCsv('a,,c')).toEqual([['a', '', 'c']]);
  });

  it('handles trailing newlines', () => {
    expect(parseCsv('a,b,\n')).toEqual([['a', 'b']]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('handles empty string', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('handles single field', () => {
    expect(parseCsv('hello')).toEqual([['hello']]);
  });

  it('handles quoted empty field', () => {
    expect(parseCsv('""')).toEqual([['']]);
  });

  it('handles multiple rows with empty fields', () => {
    expect(parseCsv('a,,c\n,d,\n')).toEqual([['a', '', 'c'], ['d', '', '']]);
  });

  it('handles complex quoted fields', () => {
    const input = '"field1","field,with,commas","field with \"quotes\""\n';
    expect(parseCsv(input)).toEqual([
      ['field1', 'field,with,commas', 'field with "quotes"'],
    ]);
  });

  it('handles newlines inside quoted fields in middle of row', () => {
    const input = 'a,"hello\nworld",c\n';
    expect(parseCsv(input)).toEqual([['a', 'hello\nworld', 'c']]);
  });
});

describe('serializeCsv', () => {
  it('serializes simple fields', () => {
    expect(serializeCsv([['a', 'b', 'c']])).toBe('a,b,c');
  });

  it('serializes multiple rows', () => {
    expect(serializeCsv([['a', 'b'], ['c', 'd']])).toBe('a,b\nc,d');
  });

  it('escapes fields with commas', () => {
    expect(serializeCsv([['a,b', 'c']])).toBe('"a,b",c');
  });

  it('escapes fields with quotes', () => {
    expect(serializeCsv([['say "hello"']])).toBe('"say ""hello"""');
  });

  it('escapes fields with newlines', () => {
    expect(serializeCsv([['hello\nworld']])).toBe('"hello\nworld"');
  });

  it('handles empty array', () => {
    expect(serializeCsv([])).toBe('');
  });

  it('handles empty fields', () => {
    expect(serializeCsv([['a', '', 'c']])).toBe('a,,c');
  });

  it('round-trips correctly', () => {
    const original = 'a,b,c\nd,"hello\nworld",f\n';
    const parsed = parseCsv(original);
    const serialized = serializeCsv(parsed);
    expect(serialized).toBe('a,b,c\nd,"hello\nworld",f');
  });

  it('handles escaped quotes round-trip', () => {
    const original = '"He said ""hello"" to her"\n';
    const parsed = parseCsv(original);
    const serialized = serializeCsv(parsed);
    expect(serialized).toBe('"He said ""hello"" to her"');
  });

  it('handles trailing newline round-trip', () => {
    const original = 'a,b,\n';
    const parsed = parseCsv(original);
    const serialized = serializeCsv(parsed);
    expect(serialized).toBe('a,b,');
  });
});
```
