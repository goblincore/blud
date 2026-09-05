```typescript
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let i = 0;

  function parseRow(): string[] {
    const fields: string[] = [];

    while (i < input.length) {
      if (input[i] === '\n' || input[i] === '\r') {
        // End of row
        if (input[i] === '\r' && i + 1 < input.length && input[i + 1] === '\n') {
          i += 2;
        } else {
          i += 1;
        }
        return fields;
      }

      if (input[i] === ',') {
        fields.push('');
        i += 1;
      } else {
        let field = '';
        if (input[i] === '"') {
          // Quoted field
          i += 1; // skip opening quote
          while (i < input.length) {
            if (input[i] === '"') {
              if (i + 1 < input.length && input[i + 1] === '"') {
                // Escaped quote
                field += '"';
                i += 2;
              } else {
                // End of quoted field
                i += 1; // skip closing quote
                // Skip to comma or newline
                while (i < input.length && input[i] !== ',' && input[i] !== '\n' && input[i] !== '\r') {
                  i += 1;
                }
                break;
              }
            } else {
              field += input[i];
              i += 1;
            }
          }
        } else {
          // Unquoted field
          while (i < input.length && input[i] !== ',' && input[i] !== '\n' && input[i] !== '\r') {
            field += input[i];
            i += 1;
          }
        }
        fields.push(field);
      }
    }

    // End of input reached
    if (fields.length === 1 && fields[0] === '') {
      return [];
    }
    return fields;
  }

  while (i < input.length) {
    if (input[i] === '\r' || input[i] === '\n') {
      if (input[i] === '\r' && i + 1 < input.length && input[i + 1] === '\n') {
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }
    const row = parseRow();
    rows.push(row);
  }

  return rows;
}

export function serializeCsv(rows: string[][]): string {
  const lines: string[] = [];

  for (const row of rows) {
    const cells: string[] = [];
    for (const cell of row) {
      if (cell.includes('"') || cell.includes(',') || cell.includes('\n') || cell.includes('\r')) {
        cells.push('"' + cell.replace(/"/g, '""') + '"');
      } else {
        cells.push(cell);
      }
    }
    lines.push(cells.join(','));
  }

  return lines.join('\n');
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
    expect(parseCsv('a,b\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('handles quoted fields', () => {
    expect(parseCsv('"hello",world')).toEqual([['hello', 'world']]);
  });

  it('handles escaped quotes', () => {
    expect(parseCsv('"hello ""world""",test')).toEqual([['hello "world"', 'test']]);
  });

  it('handles newlines inside quoted fields', () => {
    expect(parseCsv('"line1\nline2",test')).toEqual([['line1\nline2', 'test']]);
  });

  it('handles empty fields', () => {
    expect(parseCsv('a,,c')).toEqual([['a', '', 'c']]);
  });

  it('handles trailing newline', () => {
    expect(parseCsv('a,b\n')).toEqual([['a', 'b']]);
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

  it('handles empty rows from trailing newlines', () => {
    expect(parseCsv('a,b\n\n')).toEqual([['a', 'b']]);
  });

  it('handles multiple newlines between rows', () => {
    expect(parseCsv('a,b\n\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('handles quoted field with commas', () => {
    expect(parseCsv('"a,b",c')).toEqual([['a,b', 'c']]);
  });

  it('handles quoted field with newlines', () => {
    expect(parseCsv('"hello\nworld",test')).toEqual([['hello\nworld', 'test']]);
  });

  it('handles complex quoted field', () => {
    expect(parseCsv('"hello ""world""",test')).toEqual([['hello "world"', 'test']]);
  });
});

describe('serializeCsv', () => {
  it('serializes simple rows', () => {
    expect(serializeCsv([['a', 'b', 'c']])).toBe('a,b,c');
  });

  it('serializes multiple rows', () => {
    expect(serializeCsv([['a', 'b'], ['c', 'd']])).toBe('a,b\nc,d');
  });

  it('quotes fields containing commas', () => {
    expect(serializeCsv([['a,b', 'c']])).toBe('"a,b",c');
  });

  it('quotes fields containing newlines', () => {
    expect(serializeCsv([['a\nb', 'c']])).toBe('"a\nb",c');
  });

  it('quotes fields containing double quotes', () => {
    expect(serializeCsv([['a"b', 'c']])).toBe('"a""b",c');
  });

  it('roundtrips correctly', () => {
    const original = [
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ];
    const csv = serializeCsv(original);
    const parsed = parseCsv(csv);
    expect(parsed).toEqual(original);
  });

  it('roundtrips complex data', () => {
    const original = [
      ['hello "world"', 'test', '1,2'],
      ['line1\nline2', 'normal', '3'],
    ];
    const csv = serializeCsv(original);
    const parsed = parseCsv(csv);
    expect(parsed).toEqual(original);
  });

  it('handles empty array', () => {
    expect(serializeCsv([])).toBe('');
  });

  it('handles single row', () => {
    expect(serializeCsv([['a']])).toBe('a');
  });

  it('handles empty fields', () => {
    expect(serializeCsv([['a', '', 'c']])).toBe('a,,c');
  });
});
```
