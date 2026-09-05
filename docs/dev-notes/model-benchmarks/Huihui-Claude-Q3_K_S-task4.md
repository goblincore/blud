```typescript
// parseCsv.ts
export function parseCsv(input: string): string[][] {
  if (!input) return [];

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i <= input.length) {
    const ch = i < input.length ? input[i] : '';

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < input.length && input[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      currentField += ch;
      i++;
    } else {
      if (ch === '"' && currentField === '') {
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        currentRow.push(currentField);
        currentField = '';
        i++;
      } else if (ch === '\r') {
        currentRow.push(currentField);
        currentField = '';
        i++;
        if (i < input.length && input[i] === '\n') {
          i++;
        }
        rows.push(currentRow);
        currentRow = [];
      } else if (ch === '\n') {
        currentRow.push(currentField);
        currentField = '';
        i++;
        rows.push(currentRow);
        currentRow = [];
      } else {
        currentField += ch;
        i++;
      }
    }
  }

  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}

// serializeCsv.ts
export function serializeCsv(rows: string[][]): string {
  if (!rows.length) return '';

  const escaped = rows.map(row =>
    row.map(field => {
      if (field.includes('"') || field.includes(',') || field.includes('\n') || field.includes('\r')) {
        return `"${field.replace(/"/g, '""')}"`;
      }
      return field;
    }).join(',')
  );

  return escaped.join('\n') + '\n';
}

// parseCsv.test.ts
import { parseCsv } from './parseCsv';
import { serializeCsv } from './serializeCsv';
import { describe, it, expect } from 'vitest';

describe('parseCsv', () => {
  it('parses simple rows', () => {
    expect(parseCsv('a,b\nc,d\n')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('handles quoted fields', () => {
    expect(parseCsv('"a,b",c\n')).toEqual([['a,b', 'c']]);
  });

  it('handles double-escaped quotes', () => {
    expect(parseCsv('"a""b",c\n')).toEqual([['a"b', 'c']]);
  });

  it('handles newlines inside quoted fields', () => {
    expect(parseCsv('"a\nb",c\n')).toEqual([['a\nb', 'c']]);
  });

  it('handles empty fields', () => {
    expect(parseCsv(',,\n')).toEqual([['', '', '']]);
  });

  it('trims trailing newlines', () => {
    expect(parseCsv('a,b\nc,d\n\n')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('handles single field rows', () => {
    expect(parseCsv('hello\n')).toEqual([['hello']]);
  });

  it('handles empty string', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('parses Windows line endings', () => {
    expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('handles quoted field with internal quotes', () => {
    expect(parseCsv('"He said ""hello""\n')).toEqual([['He said "hello"']]);
  });

  it('parses empty lines as empty row', () => {
    expect(parseCsv('a\n\nb\n')).toEqual([['a'], [''], ['b']]);
  });

  it('handles fields with spaces', () => {
    expect(parseCsv('a b, c \n')).toEqual([['a b', ' c ']]);
  });
});

describe('serializeCsv', () => {
  it('serializes simple rows', () => {
    expect(serializeCsv([['a', 'b'], ['c', 'd']])).toBe('a,b\nc,d\n');
  });

  it('quotes fields containing commas', () => {
    expect(serializeCsv([['a,b', 'c']])).toBe('"a,b",c\n');
  });

  it('escapes double quotes', () => {
    expect(serializeCsv([['a"b', 'c']])).toBe('"a""b",c\n');
  });

  it('handles newlines in fields', () => {
    expect(serializeCsv([['a\nb', 'c']])).toBe('"a\nb",c\n');
  });

  it('handles empty rows', () => {
    expect(serializeCsv([['', '']])).toBe(',\n');
  });

  it('handles empty input', () => {
    expect(serializeCsv([])).toBe('');
  });

  it('round-trips correctly', () => {
    const data = [['a', 'b'], ['"quoted"', 'c'], ['new\nline', 'd']];
    const csv = serializeCsv(data);
    expect(parseCsv(csv)).toEqual(data);
  });
});
```

The key design decisions:

- `parseCsv` uses a single-pass character-by-character parser with a `inQuotes` flag rather than a regex, which naturally handles nested newlines, escaped quotes, and arbitrary content.
- `serializeCsv` only quotes fields that need it (contain `,`, `"`, or newlines), minimizing output size.
- The parser treats `\r\n` as a single line break and handles `\n` alone, covering both Unix and Windows line endings.
- Trailing newlines produce no empty trailing row (unless there's an explicit empty line).
