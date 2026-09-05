```typescript
/**
 * Parses a CSV string into a 2D array of strings.
 * Handles quoted fields, escaped quotes (""), newlines inside quotes, empty fields.
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
        // Check for escaped quote (double quote)
        if (i + 1 < input.length && input[i + 1] === '"') {
          currentField += '"';
          i += 2;
        } else {
          // End of quoted field
          inQuotes = false;
          i++;
        }
      } else if (char === '\n') {
        // Newline inside quoted field is part of the field value
        currentField += '\n';
        i++;
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
          i += 2;
        } else {
          i++;
        }
        currentRow.push(currentField);
        currentField = '';
        rows.push(currentRow);
        currentRow = [];
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
 * Handles escaping quotes, newlines, and commas within fields.
 */
export function serializeCsv(rows: string[][]): string {
  const serializedRows = rows.map((row) => {
    return row
      .map((field) => {
        // If field contains comma, double quote, or newline, it must be quoted
        if (field.includes(',') || field.includes('"') || field.includes('\n') || field.includes('\r')) {
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

  it('handles empty fields', () => {
    expect(parseCsv('a,,c')).toEqual([['a', '', 'c']]);
  });

  it('handles trailing newline', () => {
    expect(parseCsv('a,b\n')).toEqual([['a', 'b']]);
  });

  it('handles multiple trailing newlines', () => {
    expect(parseCsv('a,b\n\n')).toEqual([['a', 'b']]);
  });

  it('handles quoted fields with commas', () => {
    expect(parseCsv('"a,b",c')).toEqual([['a,b', 'c']]);
  });

  it('handles quoted fields with newlines', () => {
    expect(parseCsv('"a\nb",c')).toEqual([['a\nb', 'c']]);
  });

  it('handles escaped quotes', () => {
    expect(parseCsv('"a""b",c')).toEqual([['a"b', 'c']]);
  });

  it('handles complex quoted field with comma, newline, and escaped quotes', () => {
    const input = `"line1
line2 ""quoted""","a,b"`;
    expect(parseCsv(input)).toEqual([['line1\nline2 "quoted"', 'a,b']]);
  });

  it('handles empty CSV', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('handles single field', () => {
    expect(parseCsv('hello')).toEqual([['hello']]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles fields that look like they start with quote but are not quoted', () => {
    // If a field starts with a quote, it must be properly quoted
    // Unquoted fields cannot contain quotes
    expect(parseCsv('a,"b,c")).toEqual([['a', '"b,c']]);
  });
});

describe('serializeCsv', () => {
  it('serializes simple CSV', () => {
    expect(serializeCsv([['a', 'b'], ['1', '2']])).toBe('a,b\n1,2');
  });

  it('serializes empty fields', () => {
    expect(serializeCsv([['a', '', 'c']])).toBe('a,,c');
  });

  it('serializes fields with commas', () => {
    expect(serializeCsv([['a,b'], ['c']])).toBe('"a,b"\nc');
  });

  it('serializes fields with newlines', () => {
    expect(serializeCsv([['a\nb'], ['c']])).toBe('"a\nb"\nc');
  });

  it('serializes fields with double quotes', () => {
    expect(serializeCsv([['a"b'], ['c']])).toBe('"a""b"\nc');
  });

  it('serializes complex fields', () => {
    const input = [
      ['line1\nline2 "quoted"', 'a,b'],
      ['simple', 'value'],
    ];
    expect(serializeCsv(input)).toBe('"line1\nline2 ""quoted""","a,b"\nsimple,value');
  });

  it('serializes empty rows', () => {
    expect(serializeCsv([[]])).toBe('');
  });

  it('roundtrips parse and serialize', () => {
    const original = 'a,b,c\n1,"2,3",4\n5,"6\n7",8';
    const parsed = parseCsv(original);
    const serialized = serializeCsv(parsed);
    expect(serialized).toBe(original);
  });

  it('handles rows with varying column counts', () => {
    expect(serializeCsv([['a', 'b'], ['c']])).toBe('a,b\nc');
  });
});
```
