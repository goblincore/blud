```typescript
/**
 * Parses a CSV string into a 2D array of strings.
 * Handles quoted fields, escaped quotes (""), newlines within quotes, empty fields, and trailing newlines.
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
        // Check for escaped quote ""
        if (i + 1 < input.length && input[i + 1] === '"') {
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
        // End of field
        currentRow.push(currentField);
        currentField = '';
        i++;
      } else if (char === '\n') {
        // End of row
        currentRow.push(currentField);
        currentField = '';
        rows.push(currentRow);
        currentRow = [];
        i++;
      } else if (char === '\r') {
        // Handle \r\n or standalone \r
        if (i + 1 < input.length && input[i + 1] === '\n') {
          i++; // skip \n
        }
        // End of row
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

  // Handle the last field/row if the input doesn't end with a newline
  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}

/**
 * Serializes a 2D array of strings into a CSV string.
 * Handles fields containing commas, newlines, or quotes.
 */
export function serializeCsv(rows: string[][]): string {
  if (rows.length === 0) {
    return '';
  }

  const serializedRows = rows.map((row) => {
    return row
      .map((field) => {
        // Check if field needs quoting
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
      })
      .join(',');
  });

  return serializedRows.join('\n');
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

  it('parses empty fields', () => {
    expect(parseCsv(',,\n,,')).toEqual([
      ['', '', ''],
      ['', '', ''],
    ]);
  });

  it('parses quoted fields', () => {
    expect(parseCsv('"a,b",c\n1,2')).toEqual([
      ['a,b', 'c'],
      ['1', '2'],
    ]);
  });

  it('parses escaped quotes inside quoted fields', () => {
    expect(parseCsv('"say ""hello""",b')).toEqual([
      ['say "hello"', 'b'],
    ]);
  });

  it('parses newlines inside quoted fields', () => {
    expect(parseCsv('"line1\nline2",b')).toEqual([
      ['line1\nline2', 'b'],
    ]);
  });

  it('handles trailing newlines', () => {
    expect(parseCsv('a,b\n')).toEqual([['a', 'b']]);
  });

  it('handles empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('handles single row without newline', () => {
    expect(parseCsv('a,b,c')).toEqual([['a', 'b', 'c']]);
  });

  it('handles \r\n line endings', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('parses complex mixed fields', () => {
    const input = '"hello, world",foo\nbar,"baz\nqux","say ""hi"""\n,,,,';
    const expected = [
      ['hello, world', 'foo'],
      ['bar', 'baz\nqux', 'say "hi"'],
      ['', '', '', ''],
    ];
    expect(parseCsv(input)).toEqual(expected);
  });
});

describe('serializeCsv', () => {
  it('serializes simple CSV', () => {
    expect(serializeCsv([['a', 'b'], ['1', '2']])).toBe('a,b\n1,2');
  });

  it('serializes empty rows', () => {
    expect(serializeCsv([[''], ['']])).toBe(',\n,');
  });

  it('serializes fields with commas', () => {
    expect(serializeCsv([['a,b', 'c']])).toBe('"a,b",c');
  });

  it('serializes fields with quotes', () => {
    expect(serializeCsv([['say "hi"', 'b']])).toBe('"say ""hi""",b');
  });

  it('serializes fields with newlines', () => {
    expect(serializeCsv([['line1\nline2', 'b']])).toBe('"line1\nline2",b');
  });

  it('serializes empty 2D array', () => {
    expect(serializeCsv([])).toBe('');
  });

  it('round-trips complex CSV', () => {
    const original = [
      ['hello, world', 'foo'],
      ['bar', 'baz\nqux', 'say "hi"'],
      ['', '', '', ''],
    ];
    const csv = serializeCsv(original);
    const parsed = parseCsv(csv);
    expect(parsed).toEqual(original);
  });
});
```
