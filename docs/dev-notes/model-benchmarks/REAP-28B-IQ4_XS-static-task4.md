```typescript
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;
  const len = input.length;

  while (i < len) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < len && input[i + 1] === '"') {
          // Escaped quote
          currentField += '"';
          i += 2;
          continue;
        } else {
          // End of quoted field
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        // Start of quoted field
        inQuotes = true;
        i++;
        continue;
      } else if (char === ',') {
        currentRow.push(currentField);
        currentField = '';
        i++;
        continue;
      } else if (char === '\n') {
        currentRow.push(currentField);
        currentField = '';
        rows.push(currentRow);
        currentRow = [];
        i++;
        continue;
      } else if (char === '\r') {
        // Handle \r\n
        if (i + 1 < len && input[i + 1] === '\n') {
          i++;
        }
        currentRow.push(currentField);
        currentField = '';
        rows.push(currentRow);
        currentRow = [];
        i++;
        continue;
      } else {
        currentField += char;
        i++;
        continue;
      }
    }
  }

  // Push the last field/row if there's remaining data
  if (currentField || currentRow.length > 0 || (input.length > 0 && input[input.length - 1] === '\n')) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  // Remove trailing empty rows caused by trailing newlines
  while (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
    rows.pop();
  }

  return rows;
}

export function serializeCsv(rows: string[][]): string {
  return rows.map(row => 
    row.map(field => {
      const needsQuoting = field.includes(',') || field.includes('"') || field.includes('\n') || field.includes('\r');
      if (needsQuoting) {
        return `"${field.replace(/"/g, '""')}"`;
      }
      return field;
    }).join(',')
  ).join('\n');
}
```

```typescript
import { describe, it, expect } from 'vitest';
import { parseCsv, serializeCsv } from './csv-parser';

describe('parseCsv', () => {
  it('parses simple CSV', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
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

  it('handles empty fields', () => {
    expect(parseCsv('a,,c')).toEqual([['a', '', 'c']]);
  });

  it('handles trailing newlines', () => {
    expect(parseCsv('a,b\n')).toEqual([['a', 'b']]);
  });

  it('handles multiple trailing newlines', () => {
    expect(parseCsv('a,b\n\n')).toEqual([['a', 'b']]);
  });

  it('handles empty string', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('handles single field', () => {
    expect(parseCsv('a')).toEqual([['a']]);
  });

  it('handles quoted field with internal comma and newline', () => {
    expect(parseCsv('"a,b\nc"')).toEqual([['a,b\nc']]);
  });

  it('handles windows line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('parses complex CSV', () => {
    const input = `name,age,"city"
John,30,"New York"
Jane,25,"Los Angeles"
`;
    expect(parseCsv(input)).toEqual([
      ['name', 'age', 'city'],
      ['John', '30', 'New York'],
      ['Jane', '25', 'Los Angeles']
    ]);
  });
});

describe('serializeCsv', () => {
  it('serializes simple CSV', () => {
    expect(serializeCsv([['a', 'b', 'c'], ['1', '2', '3']])).toBe('a,b,c\n1,2,3');
  });

  it('quotes fields with commas', () => {
    expect(serializeCsv([['a,b', 'c']])).toBe('"a,b",c');
  });

  it('quotes fields with quotes', () => {
    expect(serializeCsv([['a"b', 'c']])).toBe('"a""b",c');
  });

  it('quotes fields with newlines', () => {
    expect(serializeCsv([['a\nb', 'c']])).toBe('"a\nb",c');
  });

  it('handles empty fields', () => {
    expect(serializeCsv([['a', '', 'c']])).toBe('a,,c');
  });

  it('handles empty rows', () => {
    expect(serializeCsv([[]])).toBe('');
  });

  it('handles empty array', () => {
    expect(serializeCsv([])).toBe('');
  });

  it('round-trips correctly', () => {
    const input = 'a,b,c\n1,"2,3",4\n5,"6""7",8';
    const parsed = parseCsv(input);
    const serialized = serializeCsv(parsed);
    const reparsed = parseCsv(serialized);
    
    expect(reparsed).toEqual(parsed);
  });

  it('handles complex round-trip', () => {
    const rows = [
      ['name', 'age', 'city'],
      ['John, Jr.', '30', 'New "York"'],
      ['Jane', '25', 'Los\nAngeles']
    ];
    const serialized = serializeCsv(rows);
    const parsed = parseCsv(serialized);
    
    expect(parsed).toEqual(rows);
  });
});
```
