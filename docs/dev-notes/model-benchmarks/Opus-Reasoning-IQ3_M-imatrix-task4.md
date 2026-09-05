```typescript
// csv-parser.ts

/**
 * Parses a CSV string into a 2D array of strings.
 * Handles quoted fields, escaped quotes (""), newlines inside quotes, empty fields, and trailing newlines.
 */
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
        // Check for escaped quote ("")
        if (i + 1 < input.length && input[i + 1] === '"') {
          currentField += '"';
          i += 2;
        } else {
          // Closing quote
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
      } else if (char === '\n') {
        currentRow.push(currentField);
        currentField = '';
        rows.push(currentRow);
        currentRow = [];
        i++;
      } else if (char === '\r') {
        // Handle \r\n or standalone \r
        if (i + 1 < input.length && input[i + 1] === '\n') {
          i++; // skip \n too
        }
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

  // Push the last field/row if there's remaining data
  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}

/**
 * Serializes a 2D array of strings into a CSV string.
 * Properly escapes fields containing commas, newlines, quotes, or whitespace.
 */
export function serializeCsv(rows: string[][]): string {
  return rows
    .map((row) => {
      return row
        .map((field) => {
          const needsQuoting =
            field.includes(',') ||
            field.includes('"') ||
            field.includes('\n') ||
            field.includes('\r') ||
            field.includes(' ') ||
            field === '';

          if (needsQuoting) {
            return `"${field.replace(/"/g, '""')}"`;
          }
          return field;
        })
        .join(',');
    })
    .join('\n');
}
```

```typescript
// csv-parser.test.ts

import { describe, it, expect } from 'vitest';
import { parseCsv, serializeCsv } from './csv-parser';

describe('parseCsv', () => {
  it('parses simple two-column rows', () => {
    expect(parseCsv('a,b\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('handles quoted fields', () => {
    expect(parseCsv('"hello",world')).toEqual([['hello', 'world']]);
  });

  it('handles escaped double quotes inside quoted fields', () => {
    expect(parseCsv('"he said ""hi""",yes')).toEqual([['he said "hi"', 'yes']]);
  });

  it('handles newlines inside quoted fields', () => {
    const input = '"line1\nline2",b';
    expect(parseCsv(input)).toEqual([['line1\nline2', 'b']]);
  });

  it('handles carriage return + newline inside quoted fields', () => {
    const input = '"line1\r\nline2",b';
    expect(parseCsv(input)).toEqual([['line1\r\nline2', 'b']]);
  });

  it('handles empty fields', () => {
    expect(parseCsv('a,,c')).toEqual([['a', '', 'c']]);
  });

  it('handles trailing newlines', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('handles multiple trailing newlines', () => {
    expect(parseCsv('a,b\n1,2\n\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('handles single field per row', () => {
    expect(parseCsv('hello\nworld')).toEqual([['hello'], ['world']]);
  });

  it('handles quoted field with commas inside', () => {
    expect(parseCsv('"a,b",c')).toEqual([['a,b', 'c']]);
  });

  it('handles empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('handles single row without newline', () => {
    expect(parseCsv('a,b,c')).toEqual([['a', 'b', 'c']]);
  });

  it('handles fields with leading/trailing spaces when quoted', () => {
    expect(parseCsv('" hello "," world "')).toEqual([[' hello ', ' world ']]);
  });

  it('handles empty quoted field', () => {
    expect(parseCsv('""')).toEqual([['']]);
  });

  it('handles row with only commas (empty fields)', () => {
    expect(parseCsv(',,' )).toEqual([['', '', '']]);
  });

  it('handles mixed quoted and unquoted fields', () => {
    const input = 'a,"b,c",d,"e""f",g';
    expect(parseCsv(input)).toEqual([['a', 'b,c', 'd', 'e"f', 'g']]);
  });

  it('preserves empty fields at end of row', () => {
    expect(parseCsv('a,b,\n1,2,')).toEqual([['a', 'b', ''], ['1', '2', '']]);
  });

  it('handles quoted field containing only a newline', () => {
    expect(parseCsv('"\n"')).toEqual([['\n']]);
  });

  it('handles multiple quoted fields with embedded newlines', () => {
    const input = '"hello\nworld","foo\nbar"';
    expect(parseCsv(input)).toEqual([['hello\nworld', 'foo\nbar']]);
  });

  it('handles standalone \r (old Mac line ending)', () => {
    expect(parseCsv('a\rb')).toEqual([['a'], ['b']]);
  });

  it('handles quoted field containing \\r\\n', () => {
    const input = '"a\r\nb",c';
    expect(parseCsv(input)).toEqual([['a\r\nb', 'c']]);
  });

  it('handles multiple rows with quoted fields containing newlines', () => {
    const input = '"row1\nrow1",x\n"row2\nrow2",y';
    expect(parseCsv(input)).toEqual([
      ['row1\nrow1', 'x'],
      ['row2\nrow2', 'y'],
    ]);
  });

  it('handles escaped quote at the very end of a quoted field', () => {
    const input = '"hello"""';
    expect(parseCsv(input)).toEqual([['hello"']]);
  });

  it('handles field that is just a double quote', () => {
    const input = '""""';
    expect(parseCsv(input)).toEqual([['"']]);
  });

  it('handles whitespace-only quoted field', () => {
    expect(parseCsv('"   "')).toEqual([['   ']]);
  });
});

describe('serializeCsv', () => {
  it('serializes a simple 2x2 grid', () => {
    const input: string[][] = [
      ['a', 'b'],
      ['c', 'd'],
    ];
    expect(serializeCsv(input)).toBe('a,b\nc,d');
  });

  it('serializes fields containing commas', () => {
    const input: string[][] = [['a,b', 'c']];
    expect(serializeCsv(input)).toBe('"a,b",c');
  });

  it('serializes fields containing double quotes', () => {
    const input: string[][] = [['he said "hi"', 'yes']];
    expect(serializeCsv(input)).toBe('"he said ""hi""",yes');
  });

  it('serializes fields containing newlines', () => {
    const input: string[][] = [['line1\nline2', 'b']];
    expect(serializeCsv(input)).toBe('"line1\nline2",b');
  });

  it('serializes fields containing carriage returns', () => {
    const input: string[][] = [['a\r', 'b']];
    expect(serializeCsv(input)).toBe('"a\r",b');
  });

  it('serializes fields containing leading/trailing spaces', () => {
    const input: string[][] = [[' hello ', 'b']];
    expect(serializeCsv(input)).toBe('" hello ",b');
  });

  it('serializes empty fields', () => {
    const input: string[][] = [['a', '', 'c']];
    expect(serializeCsv(input)).toBe('a,,c');
  });

  it('serializes empty rows', () => {
    const input: string[][] = [['a', 'b'], [], ['c', 'd']];
    expect(serializeCsv(input)).toBe('a,b\n\nc,d');
  });

  it('serializes empty input', () => {
    expect(serializeCsv([])).toBe('');
  });

  it('roundtrips through parseCsv and serializeCsv', () => {
    const csv = 'a,b,c\n"hello, world","he said ""hi""",d\n1,2,3';
    const parsed = parseCsv(csv);
    const serialized = serializeCsv(parsed);
    expect(serialized).toBe(csv);
  });

  it('serializes single row with single field', () => {
    const input: string[][] = [['hello']];
    expect(serializeCsv(input)).toBe('hello');
  });

  it('serializes single field containing newline', () => {
    const input: string[][] = [['a\nb']];
    expect(serializeCsv(input)).toBe('"a\nb"');
  });

  it('serializes field with only a double quote', () => {
    const input: string[][] = [['"']];
    expect(serializeCsv(input)).toBe('"""');
  });

  it('serializes multiple rows with various edge cases', () => {
    const input: string[][] = [
      ['a', 'b'],
      ['"hello"', 'world'],
      ['foo,bar', 'baz'],
      ['line1\nline2', 'single'],
    ];
    const result = serializeCsv(input);
    const parsed = parseCsv(result);
    expect(parsed).toEqual(input);
  });
});
```
