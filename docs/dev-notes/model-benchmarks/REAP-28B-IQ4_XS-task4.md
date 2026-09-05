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

  // Push the last field/row if there's remaining data
  if (currentField.length > 0 || currentRow.length > 0 || input.length === 0) {
    // If input ends with newline, we might have an empty row pushed already.
    // Standard behavior: if input ends with newline, the last row is usually considered empty or ignored depending on spec.
    // Here, if we have accumulated content in currentField or currentRow, push it.
    // If the input ended with a newline, currentRow was pushed in the loop. 
    // However, if the input is just "a,b\n", the loop pushes ["a","b"]. 
    // If input is "a,b", we need to push the last row.
    
    // Check if the last character was a newline. If so, currentRow is empty and we shouldn't push an empty row unless it was intentional (e.g. empty lines).
    // But standard CSV parsers often ignore trailing empty rows.
    // Let's check if currentRow is empty and currentField is empty.
    if (currentRow.length > 0 || currentField.length > 0) {
      currentRow.push(currentField);
      rows.push(currentRow);
    } else if (input.length > 0 && input[input.length - 1] !== '\n' && input[input.length - 1] !== '\r') {
       // This case is covered by currentField > 0 or currentRow > 0 usually, but if input is empty string, we return []
    }
  }
  
  // Edge case: empty input
  if (input === '') {
    return [];
  }

  return rows;
}

export function serializeCsv(rows: string[][]): string {
  return rows.map(row => 
    row.map(field => {
      const str = String(field);
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(',')
  ).join('\n');
}
```

```typescript
import { describe, it, expect } from 'vitest';
import { parseCsv, serializeCsv } from './csv';

describe('parseCsv', () => {
  it('parses simple CSV', () => {
    expect(parseCsv('a,b\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('handles quoted fields', () => {
    expect(parseCsv('"a","b"')).toEqual([['a', 'b']]);
  });

  it('handles escaped quotes', () => {
    expect(parseCsv('"a""b",c')).toEqual([['a"b', 'c']]);
  });

  it('handles newlines inside quoted fields', () => {
    expect(parseCsv('"a\nb",c')).toEqual([['a\nb', 'c']]);
  });

  it('handles empty fields', () => {
    expect(parseCsv('a,,b')).toEqual([['a', '', 'b']]);
  });

  it('handles trailing newlines', () => {
    expect(parseCsv('a,b\n')).toEqual([['a', 'b']]);
  });

  it('handles empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('handles multiple rows with quoted newlines', () => {
    const input = '"Hello\nWorld",foo\nbar,"baz"';
    expect(parseCsv(input)).toEqual([
      ['Hello\nWorld', 'foo'],
      ['bar', 'baz']
    ]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });
});

describe('serializeCsv', () => {
  it('serializes simple rows', () => {
    expect(serializeCsv([['a', 'b'], ['c', 'd']])).toBe('a,b\nc,d');
  });

  it('quotes fields with commas', () => {
    expect(serializeCsv([['a,b', 'c']])).toBe('"a,b",c');
  });

  it('quotes fields with newlines', () => {
    expect(serializeCsv([['a\nb', 'c']])).toBe('"a\nb",c');
  });

  it('escapes quotes inside fields', () => {
    expect(serializeCsv([['a"b', 'c']])).toBe('"a""b",c');
  });

  it('handles empty rows', () => {
    expect(serializeCsv([['', '']])).toBe(',,');
  });
});

describe('Roundtrip', () => {
  it('parses what it serializes', () => {
    const original = [
      ['a', 'b'],
      ['c,d', 'e'],
      ['"f"', 'g']
    ];
    const serialized = serializeCsv(original);
    const parsed = parseCsv(serialized);
    expect(parsed).toEqual(original);
  });
});
```
