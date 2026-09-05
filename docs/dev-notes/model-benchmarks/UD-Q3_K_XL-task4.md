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
        inQuotes = true;
        i++;
      } else if (char === ',') {
        currentRow.push(currentField);
        currentField = '';
        i++;
      } else if (char === '\r') {
        // Handle \r\n or standalone \r
        if (i + 1 < input.length && input[i + 1] === '\n') {
          i++; // skip \n
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

  // Push the last field/row if not empty
  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}

export function serializeCsv(rows: string[][]): string {
  if (rows.length === 0) {
    return '';
  }

  const result: string[] = rows.map(row => {
    return row.map(field => {
      // If field contains comma, quote, newline, or carriage return, quote it
      if (
        field.includes(',') ||
        field.includes('"') ||
        field.includes('\n') ||
        field.includes('\r')
      ) {
        // Escape double quotes by doubling them
        const escaped = field.replace(/"/g, '""');
        return `"${escaped}"`;
      }
      return field;
    }).join(',');
  });

  return result.join('\n');
}
```

```typescript
import { describe, it, expect } from 'vitest';
import { parseCsv, serializeCsv } from './csv';

describe('parseCsv', () => {
  it('parses simple CSV', () => {
    expect(parseCsv('a,b,c')).toEqual([['a', 'b', 'c']]);
  });

  it('parses multiple rows', () => {
    expect(parseCsv('a,b\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('handles quoted fields', () => {
    expect(parseCsv('"a,b",c')).toEqual([['a,b', 'c']]);
  });

  it('handles escaped quotes inside quoted fields', () => {
    expect(parseCsv('"a""b",c')).toEqual([['a"b', 'c']]);
  });

  it('handles newlines inside quoted fields', () => {
    expect(parseCsv('"a\nb",c')).toEqual([['a\nb', 'c']]);
  });

  it('handles empty fields', () => {
    expect(parseCsv(',b,')).toEqual([['', 'b', '']]);
  });

  it('handles trailing newlines', () => {
    expect(parseCsv('a,b\n')).toEqual([['a', 'b']]);
  });

  it('handles empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('handles empty lines', () => {
    expect(parseCsv('a,b\n\nc,d')).toEqual([
      ['a', 'b'],
      [],
      ['c', 'd'],
    ]);
  });

  it('handles \r\n line endings', () => {
    expect(parseCsv('a,b\r\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('handles complex quoted fields with newlines and escaped quotes', () => {
    const input = '"hello,\nworld","say ""hi"""\nfoo,bar';
    expect(parseCsv(input)).toEqual([
      ['hello,\nworld', 'say "hi"'],
      ['foo', 'bar'],
    ]);
  });

  it('handles single field row', () => {
    expect(parseCsv('hello')).toEqual([['hello']]);
  });

  it('handles single quoted field', () => {
    expect(parseCsv('"hello"')).toEqual([['hello']]);
  });

  it('handles empty quoted field', () => {
    expect(parseCsv('""')).toEqual([['']]);
  });
});

describe('serializeCsv', () => {
  it('serializes simple CSV', () => {
    expect(serializeCsv([['a', 'b', 'c']])).toBe('a,b,c');
  });

  it('serializes multiple rows', () => {
    expect(serializeCsv([['a', 'b'], ['c', 'd']])).toBe('a,b\nc,d');
  });

  it('quotes fields containing commas', () => {
    expect(serializeCsv([['a,b', 'c']])).toBe('"a,b",c');
  });

  it('quotes fields containing double quotes', () => {
    expect(serializeCsv([['a"b', 'c']])).toBe('"a""b",c');
  });

  it('quotes fields containing newlines', () => {
    expect(serializeCsv([['a\nb', 'c']])).toBe('"a\nb",c');
  });

  it('handles empty fields', () => {
    expect(serializeCsv([['', 'b', '']])).toBe(',b,');
  });

  it('handles empty rows array', () => {
    expect(serializeCsv([])).toBe('');
  });

  it('round-trips correctly', () => {
    const original = [
      ['a', 'b'],
      ['hello, world', 'say "hi"'],
      ['new\nline', ''],
    ];
    const serialized = serializeCsv(original);
    const parsed = parseCsv(serialized);
    expect(parsed).toEqual(original);
  });

  it('handles rows with single field', () => {
    expect(serializeCsv([['hello']])).toBe('hello');
  });
});
```
