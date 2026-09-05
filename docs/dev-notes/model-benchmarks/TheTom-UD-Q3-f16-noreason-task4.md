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
        // Check for escaped quote
        if (i + 1 < input.length && input[i + 1] === '"') {
          currentField += '"';
          i += 2;
        } else {
          // End of quoted field
          inQuotes = false;
          i++;
        }
      } else if (char === '\n') {
        // Newline inside quoted field
        currentField += '\n';
        i++;
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
        // Handle \r\n
        if (i + 1 < input.length && input[i + 1] === '\n') {
          i++;
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

  // Handle last field/row
  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  // Remove trailing empty rows if the input ends with newlines
  while (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
    rows.pop();
  }

  return rows;
}

export function serializeCsv(rows: string[][]): string {
  const result: string[] = [];

  for (const row of rows) {
    const fields: string[] = [];
    for (const field of row) {
      // Check if field needs quoting
      if (
        field.includes(',') ||
        field.includes('"') ||
        field.includes('\n') ||
        field.includes('\r') ||
        field === ''
      ) {
        // Escape quotes by doubling them
        const escaped = field.replace(/"/g, '""');
        fields.push(`"${escaped}"`);
      } else {
        fields.push(field);
      }
    }
    result.push(fields.join(','));
  }

  return result.join('\n');
}
```

```typescript
import { describe, it, expect } from 'vitest';
import { parseCsv, serializeCsv } from './csv';

describe('parseCsv', () => {
  it('parses simple rows', () => {
    expect(parseCsv('a,b,c\nd,e,f')).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ]);
  });

  it('handles empty fields', () => {
    expect(parseCsv('a,,c')).toEqual([['a', '', 'c']]);
  });

  it('handles quoted fields', () => {
    expect(parseCsv('"a,b",c')).toEqual([['a,b', 'c']]);
  });

  it('handles escaped quotes', () => {
    expect(parseCsv('"a""b",c')).toEqual([['a"b', 'c']]);
  });

  it('handles newlines inside quoted fields', () => {
    expect(parseCsv('"a\nb",c')).toEqual([['a\nb', 'c']]);
  });

  it('handles trailing newlines', () => {
    expect(parseCsv('a,b\n')).toEqual([['a', 'b']]);
    expect(parseCsv('a,b\n\n')).toEqual([['a', 'b']]);
  });

  it('handles empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('handles single row without newline', () => {
    expect(parseCsv('a,b,c')).toEqual([['a', 'b', 'c']]);
  });

  it('handles complex mixed fields', () => {
    const input = '"hello, world","line1\nline2","say ""hi"""';
    expect(parseCsv(input)).toEqual([
      ['hello, world', 'line1\nline2', 'say "hi"'],
    ]);
  });

  it('handles multiple rows with quoted fields', () => {
    const input = '"a","b"\n"c","d"';
    expect(parseCsv(input)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('handles empty quoted fields', () => {
    expect(parseCsv('""')).toEqual([['']]);
  });

  it('handles empty quoted fields in multi-field row', () => {
    expect(parseCsv(',"",""')).toEqual([['', '', '']]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('handles trailing newlines with data', () => {
    expect(parseCsv('a,b\n\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});

describe('serializeCsv', () => {
  it('serializes simple rows', () => {
    expect(serializeCsv([['a', 'b'], ['c', 'd']])).toBe('a,b\nc,d');
  });

  it('handles fields with commas', () => {
    expect(serializeCsv([['a,b', 'c']])).toBe('"a,b",c');
  });

  it('handles fields with quotes', () => {
    expect(serializeCsv([['a"b', 'c']])).toBe('"a""b",c');
  });

  it('handles fields with newlines', () => {
    expect(serializeCsv([['a\nb', 'c']])).toBe('"a\nb",c');
  });

  it('handles empty fields', () => {
    expect(serializeCsv([['a', '', 'c']])).toBe('a,,c');
  });

  it('roundtrips correctly', () => {
    const original = [
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ];
    const serialized = serializeCsv(original);
    const parsed = parseCsv(serialized);
    expect(parsed).toEqual(original);
  });

  it('roundtrips complex data', () => {
    const original = [
      ['hello, world', 'line1\nline2', 'say "hi"'],
      ['simple', 'data', 'here'],
    ];
    const serialized = serializeCsv(original);
    const parsed = parseCsv(serialized);
    expect(parsed).toEqual(original);
  });

  it('handles empty rows array', () => {
    expect(serializeCsv([])).toBe('');
  });

  it('handles rows with empty fields', () => {
    expect(serializeCsv([['', 'a', '']])).toBe(',a,');
  });
});
```
