```typescript
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < input.length) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < input.length && input[i + 1] === '"') {
          // Escaped quote
          currentField += '"';
          i += 2;
        } else {
          // End of quoted field
          inQuotes = false;
          i++;
        }
      } else {
        currentField += char;
        i++;
      }
    } else {
      if (char === '"') {
        // Start of quoted field
        inQuotes = true;
        i++;
      } else if (char === ',') {
        currentRow.push(currentField);
        currentField = '';
        i++;
      } else if (char === '\r') {
        // Handle \r\n
        if (i + 1 < input.length && input[i + 1] === '\n') {
          i++;
        }
        currentRow.push(currentField);
        currentField = '';
        rows.push(currentRow);
        currentRow = [];
        i++;
      } else if (char === '\n') {
        currentRow.push(currentField);
        currentField = '';
        rows.push(currentRow);
        currentRow = [];
        i++;
      } else {
        currentField += char;
        i++;
      }
    }
  }

  // If there's remaining content in the current field/row
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}

export function serializeCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((field) => {
          if (field.includes(',') || field.includes('"') || field.includes('\n') || field.includes('\r')) {
            return `"${field.replace(/"/g, '""')}"`;
          }
          return field;
        })
        .join(',')
    )
    .join('\n');
}
```

```typescript
import { describe, it, expect } from 'vitest';
import { parseCsv, serializeCsv } from './csv';

describe('parseCsv', () => {
  it('parses simple CSV', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles quoted fields', () => {
    expect(parseCsv('"hello","world"')).toEqual([['hello', 'world']]);
  });

  it('handles escaped quotes', () => {
    expect(parseCsv('"hello ""world"""')).toEqual([['hello "world"']]);
  });

  it('handles newlines inside quoted fields', () => {
    expect(parseCsv('"line1\nline2",b')).toEqual([['line1\nline2', 'b']]);
  });

  it('handles empty fields', () => {
    expect(parseCsv('a,,c')).toEqual([['a', '', 'c']]);
  });

  it('handles trailing newlines', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('handles single field', () => {
    expect(parseCsv('hello')).toEqual([['hello']]);
  });

  it('handles \r\n line endings', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles complex nested quotes', () => {
    const input = '"hello ""world""","foo""bar"';
    expect(parseCsv(input)).toEqual([['hello "world"', 'foo"bar']]);
  });
});

describe('serializeCsv', () => {
  it('serializes simple rows', () => {
    expect(serializeCsv([['a', 'b'], ['1', '2']])).toBe('a,b\n1,2');
  });

  it('quotes fields with commas', () => {
    expect(serializeCsv([['a,b', 'c']])).toBe('"a,b",c');
  });

  it('quotes fields with newlines', () => {
    expect(serializeCsv([['a\nb', 'c']])).toBe('"a\nb",c');
  });

  it('quotes fields with double quotes', () => {
    expect(serializeCsv([['a"b', 'c']])).toBe('"a""b",c');
  });

  it('round-trips correctly', () => {
    const original = [
      ['a', 'b'],
      ['hello "world"', 'foo'],
      ['line1\nline2', 'bar'],
    ];
    const serialized = serializeCsv(original);
    const parsed = parseCsv(serialized);
    expect(parsed).toEqual(original);
  });
});
```
