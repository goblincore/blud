```typescript
import { parseCsv, serializeCsv } from './csv';

// Test suite
describe('parseCsv', () => {
  it('parses simple rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles quoted fields', () => {
    expect(parseCsv('"a","b","c"\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles escaped quotes inside quoted fields', () => {
    expect(parseCsv('"he said ""hello""",1')).toEqual([
      ['he said "hello"', '1'],
    ]);
  });

  it('handles newlines inside quoted fields', () => {
    expect(parseCsv('a,"line1\nline2",3')).toEqual([
      ['a', 'line1\nline2', '3'],
    ]);
  });

  it('handles empty fields', () => {
    expect(parseCsv(',,')).toEqual([['', '', '']]);
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

  it('parses multiple rows with mixed quoting', () => {
    const input = `"a","b","c"\n1,2,3\n4,"5",6`;
    expect(parseCsv(input)).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
      ['4', '5', '6'],
    ]);
  });

  it('handles newlines in middle of quoted field', () => {
    const input = 'a,"line1\nline2\nline3",3';
    expect(parseCsv(input)).toEqual([
      ['a', 'line1\nline2\nline3', '3'],
    ]);
  });

  it('handles escaped quotes at start/end of quoted field', () => {
    const input = '"\"hello\"","world"';
    expect(parseCsv(input)).toEqual([['"hello"', 'world']]);
  });

  it('handles trailing whitespace after quoted fields', () => {
    const input = 'a, "b" , c';
    expect(parseCsv(input)).toEqual([['a', 'b', 'c']]);
  });
});

describe('serializeCsv', () => {
  it('serializes simple rows', () => {
    expect(serializeCsv([['a', 'b'], ['1', '2']])).toEqual('a,b\n1,2');
  });

  it('quotes fields containing commas', () => {
    expect(serializeCsv([['a,b', 'c']])).toEqual('"a,b",c');
  });

  it('quotes fields containing newlines', () => {
    expect(serializeCsv([['a\nb', 'c']])).toEqual('"a\nb",c');
  });

  it('doubles quotes inside fields', () => {
    expect(serializeCsv([['he said "hi"', 'c']])).toEqual('"he said ""hi""",c');
  });

  it('handles empty fields', () => {
    expect(serializeCsv([['', 'b'], ['a', '']])).toEqual(',,b\na,');
  });

  it('handles empty array', () => {
    expect(serializeCsv([])).toEqual('');
  });

  it('handles single row', () => {
    expect(serializeCsv([['a', 'b', 'c']])).toEqual('a,b,c');
  });

  it('round-trips correctly', () => {
    const original = [
      ['a', 'b', 'c'],
      ['1', '2', '3'],
      ['he said "hello"', 'world'],
      ['line1\nline2', 'end'],
    ];
    const serialized = serializeCsv(original);
    const parsed = parseCsv(serialized);
    expect(parsed).toEqual(original);
  });
});
```

## Implementation

```typescript
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let current = '';
  let inQuoted = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inQuoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          // Escaped quote
          current += '"';
          i++;
        } else {
          // End of quoted field
          inQuoted = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuoted = true;
      } else if (char === '\n') {
        row.push(current);
        current = '';
        rows.push(row);
        row = [];
      } else if (char === ',') {
        row.push(current);
        current = '';
      } else {
        current += char;
      }
    }
  }

  // Push last field/row
  if (current || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  return rows;
}

export function serializeCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((field) => {
          if (field.includes(',') || field.includes('"') || field.includes('\n')) {
            return `"${field.replace(/"/g, '""')}"`;
          }
          return field;
        })
        .join(',')
    )
    .join('\n');
}
```
