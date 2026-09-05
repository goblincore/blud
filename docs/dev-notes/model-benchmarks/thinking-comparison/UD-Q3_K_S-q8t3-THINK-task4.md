<!-- reasoning_content (23967 chars) -->
Here's a thinking process:

1.  **Understand User Requirements:**
   - **Input/Output:** `parseCsv(input: string): string[][]` and `serializeCsv(rows: string[][]): string`
   - **Features to handle:**
     - Quoted fields (double quotes)
     - Escaped quotes (double-double-quote inside quoted fields)
     - Newlines inside quoted fields
     - Empty fields
     - Trailing newlines
   - **Testing:** Comprehensive `vitest` tests with edge cases
   - **Language:** TypeScript
   - **Style:** Concise, clean, no explanations unless asked

2.  **Design `parseCsv`:**
   - CSV parsing is notoriously tricky. I need a state machine or a robust regex/iterator approach.
   - Standard CSV rules (RFC 4180-ish but more permissive for real-world data):
     - Fields are separated by commas
     - Fields may be enclosed in double quotes
     - Double quotes inside quoted fields are escaped by doubling them
     - Newlines can be inside quoted fields
     - Empty fields are valid
     - Trailing newlines should be ignored/trimmed
   - I'll implement a character-by-character parser for robustness.
   - State variables: `inQuotes`, `currentField`, `currentRow`, `rows`
   - Loop through each character:
     - If `inQuotes`:
       - If char is `"`, check next char. If next is `"`, append `"` and skip next. If next is `,`, `\n`, or end, close quote. Otherwise, append `"` and continue.
       - Else, append char.
     - If not `inQuotes`:
       - If char is `,`, push `currentField`, reset.
       - If char is `\n` (or `\r\n`), push `currentField`, push row, reset. Handle `\r` carefully.
       - If char is `"` and it's the start of a field (or after comma/start), enter `inQuotes`.
       - Else, append char.
   - Need to handle `\r\n` properly.
   - Let's refine the state machine approach. It's more reliable than regex for this.

   Algorithm sketch:
   ```typescript
   function parseCsv(input: string): string[][] {
     const rows: string[][] = [];
     let row: string[] = [];
     let field = '';
     let inQuotes = false;
     let i = 0;

     while (i < input.length) {
       const char = input[i];
       const nextChar = input[i + 1];

       if (inQuotes) {
         if (char === '"') {
           if (nextChar === '"') {
             field += '"';
             i += 2;
             continue;
           } else if (nextChar === ',' || nextChar === '\n' || nextChar === '\r' || nextChar === undefined) {
             inQuotes = false;
             i++;
             continue;
           } else {
             field += char;
             i++;
             continue;
           }
         } else if (char === '\r' && nextChar === '\n') {
           // Handle \r\n inside quoted field
           field += '\n';
           i += 2;
           continue;
         } else if (char === '\r' || char === '\n') {
           field += '\n';
           i++;
           continue;
         } else {
           field += char;
           i++;
           continue;
         }
       } else {
         if (char === ',' && field === '') {
           // Actually, comma handling should be simpler
         }
         // Let's rethink: better to handle comma/newline outside quotes directly
         if (char === ',') {
           row.push(field);
           field = '';
           i++;
           continue;
         }
         if (char === '\n' || (char === '\r' && nextChar === '\n')) {
           row.push(field);
           field = '';
           if (row.length > 0 || (rows.length > 0 && rows[rows.length - 1].length > 0)) {
             rows.push(row);
           }
           row = [];
           i += (char === '\r' ? 2 : 1);
           continue;
         }
         if (char === '\r') {
           row.push(field);
           field = '';
           rows.push(row);
           row = [];
           i++;
           continue;
         }
         if (char === '"' && field === '') {
           inQuotes = true;
           i++;
           continue;
         }
         field += char;
         i++;
       }
     }
     // Push last field/row
     row.push(field);
     if (row.length > 0 || (rows.length > 0 && rows[rows.length - 1].length > 0)) {
       rows.push(row);
     }
     return rows;
   }
   ```
   Wait, this has some flaws. Let's trace carefully.
   - Empty fields: `a,,b` -> `['a', '', 'b']`. My logic: when `,` encountered, push `field` (which is `''`), reset to `''`. Works.
   - Trailing newlines: `a,b\n` -> pushes `row` at `\n`, then at end `row` is empty, condition `row.length > 0 || ...` handles it. But what about `a,b\n\n`? The second `\n` will push an empty `row`, and the condition might skip it or add it. Usually, trailing newlines should be ignored. I'll filter out empty rows at the end, or handle trailing newlines by trimming input first, or adjusting the condition.
   - Actually, CSV parsers usually ignore completely empty trailing rows. I'll add a check: `if (row.length === 1 && row[0] === '') return rows;` at the end if the last row is empty. Or just trim trailing newlines from input initially: `input = input.replace(/\r?\n$/, '');` but that might break if the last field intentionally ends with newline? No, CSV fields don't end with newline unless quoted. I'll stick to handling it in the loop or filter at the end.
   - Let's refine the state machine to be more robust and standard.

   Better approach:
   ```typescript
   function parseCsv(input: string): string[][] {
     const rows: string[][] = [];
     let row: string[] = [];
     let field = '';
     let inQuotes = false;
     let i = 0;

     while (i < input.length) {
       const char = input[i];
       const nextChar = input[i + 1];

       if (inQuotes) {
         if (char === '"') {
           if (nextChar === '"') {
             field += '"';
             i += 2;
           } else {
             inQuotes = false;
             i++;
           }
         } else if (char === '\r' && nextChar === '\n') {
           field += '\n';
           i += 2;
         } else if (char === '\n' || char === '\r') {
           field += '\n';
           i++;
         } else {
           field += char;
           i++;
         }
       } else {
         if (char === ',') {
           row.push(field);
           field = '';
           i++;
         } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
           row.push(field);
           field = '';
           if (row.length > 0 || rows.length > 0) {
             rows.push(row);
           }
           row = [];
           i += (char === '\r' ? 2 : 1);
         } else if (char === '\r') {
           row.push(field);
           field = '';
           rows.push(row);
           row = [];
           i++;
         } else if (char === '"' && field === '') {
           inQuotes = true;
           i++;
         } else {
           field += char;
           i++;
         }
       }
     }

     row.push(field);
     if (row.length > 0 || rows.length > 0) {
       rows.push(row);
     }

     // Handle trailing empty rows from trailing newlines
     while (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
       rows.pop();
     }

     return rows;
   }
   ```
   Let's test this mentally:
   - Input: `a,b\n`
     - `i=0`, `char='a'`, `field='a'`, `i=1`
     - `i=1`, `char=','`, push `'a'`, `row=['a']`, `field=''`, `i=2`
     - `i=2`, `char='b'`, `field='b'`, `i=3`
     - `i=3`, `char='\n'`, push `'b'`, `row=['a','b']`, `rows=[['a','b']]`, `row=[]`, `i=4`
     - Loop ends. `row.push('')` -> `row=['']`. Condition `row.length > 0` is true, pushes `['']` to rows.
     - Trailing check pops it. Returns `[['a','b']]`. Correct.
   - Input: `""`
     - `i=0`, `char='"'`, `field=''`, enters quotes, `i=1`
     - `i=1`, `char='"'`, `nextChar=undefined`, `inQuotes=false`, `i=2`
     - Loop ends. `row.push('')` -> `row=['']`, pushes `['']`. Trailing check pops it. Returns `[]`. Is that correct? An empty CSV with just quotes should probably be `[]` or `[[]]`? Usually `""` means one empty field. Let's adjust: if input is just `""`, it should probably return `[[]]` or `[[""]]`. Actually, RFC says `""` is one empty field. My code treats it as empty row. I'll adjust the trailing check to only remove rows that are completely empty and result from trailing newlines, not from valid empty fields.
     - Better: `input = input.trimEnd();` but that removes spaces. CSV allows spaces. I'll handle trailing newlines explicitly: `input = input.replace(/(?:\r?\n)+$/, '');` at the start. That's safer.
     - Let's add `input = input.replace(/(?:\r?\n)+$/, '');` at the top.

   Revised:
   ```typescript
   function parseCsv(input: string): string[][] {
     input = input.replace(/(?:\r?\n)+$/, '');
     if (input === '') return [];

     const rows: string[][] = [];
     let row: string[] = [];
     let field = '';
     let inQuotes = false;
     let i = 0;

     while (i < input.length) {
       const char = input[i];
       const nextChar = input[i + 1];

       if (inQuotes) {
         if (char === '"') {
           if (nextChar === '"') {
             field += '"';
             i += 2;
           } else {
             inQuotes = false;
             i++;
           }
         } else if (char === '\r' && nextChar === '\n') {
           field += '\n';
           i += 2;
         } else if (char === '\n' || char === '\r') {
           field += '\n';
           i++;
         } else {
           field += char;
           i++;
         }
       } else {
         if (char === ',') {
           row.push(field);
           field = '';
           i++;
         } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
           row.push(field);
           field = '';
           rows.push(row);
           row = [];
           i += (char === '\r' ? 2 : 1);
         } else if (char === '\r') {
           row.push(field);
           field = '';
           rows.push(row);
           row = [];
           i++;
         } else if (char === '"' && field === '') {
           inQuotes = true;
           i++;
         } else {
           field += char;
           i++;
         }
       }
     }

     row.push(field);
     if (row.length > 0 || rows.length > 0) {
       rows.push(row);
     }

     return rows;
   }
   ```
   Test `""` again:
   - `input` becomes `""`
   - `i=0`, `char='"'`, `field=''`, `inQuotes=true`, `i=1`
   - `i=1`, `char='"'`, `nextChar=undefined`, `inQuotes=false`, `i=2`
   - Loop ends. `row.push('')` -> `['']`. `rows` gets `[[]]`? Wait, `row.push(field)` adds `''` to `row`. `row` was `[]`. So `row` becomes `['']`. Then `rows.push(row)` adds `['']`. Returns `[[]]`. That's correct for a single empty field row.
   - Test `a,b` (no newline):
     - `a` -> `field='a'`
     - `,` -> `row=['a']`, `field=''`
     - `b` -> `field='b'`
     - End: `row.push('b')` -> `['a','b']`. `rows` gets `[['a','b']]`. Correct.
   - Test `a,,b`:
     - `a` -> `field='a'`
     - `,` -> `row=['a']`, `field=''`
     - `,` -> `row=['a','']`, `field=''`
     - `b` -> `field='b'`
     - End: `row.push('b')` -> `['a','','b']`. Correct.
   - Test `"a\nb"`:
     - `"` -> `inQuotes=true`
     - `a` -> `field='a'`
     - `\n` -> `field='a\n'`
     - `b` -> `field='a\nb'`
     - `"` -> `inQuotes=false`
     - End: `row=['a\nb']`. Correct.
   - Test `"a""b"`:
     - `"` -> `inQuotes=true`
     - `a` -> `field='a'`
     - `"` -> `nextChar='"'`, `field='a"'`, `i+=2`
     - `b` -> `field='a"b'`
     - `"` -> `inQuotes=false`
     - End: `row=['a"b']`. Correct.
   - Looks solid.

3.  **Design `serializeCsv`:**
   - Needs to convert `string[][]` back to CSV string.
   - Rules:
     - Fields containing `,`, `"`, `\n`, `\r` must be quoted.
     - Quotes inside fields are escaped by doubling them.
     - Rows joined by `\n`.
   - Implementation:
     ```typescript
     function serializeCsv(rows: string[][]): string {
       return rows.map(row =>
         row.map(field => {
           if (/[,"\r\n]/.test(field)) {
             return `"${field.replace(/"/g, '""')}"`;
           }
           return field;
         }).join(',')
       ).join('\n');
     }
     ```
   - Check edge cases:
     - Empty rows: `[[]]` -> `""` (correct, or `""`?) Actually, `[[]]` should probably serialize to `""` or just empty string? RFC says an empty row is represented by nothing or just a newline? I'll stick to `""` for empty row, or maybe `""` is fine. Actually, `[[]]` -> `row.map` gives `['']`, joins to `''`, so `""`. That's acceptable.
     - Fields with newlines: `"a\nb"` -> `["\"a\\nb\""]` -> `"a\nb"` (correct)
     - Fields with quotes: `a"b` -> `"a""b"` (correct)
     - Fields with commas: `a,b` -> `"a,b"` (correct)
     - Looks good.

4.  **Write Vitest Tests:**
   - Need comprehensive tests covering:
     - Basic parsing & serialization roundtrip
     - Quoted fields
     - Escaped quotes
     - Newlines in quoted fields
     - Empty fields
     - Trailing newlines
     - Mixed line endings (`\r\n`, `\n`, `\r`)
     - Empty input
     - Single field
     - Multiple rows
     - Fields with spaces
     - Serialization edge cases (fields needing quoting)
   - Structure:
     ```typescript
     import { describe, it, expect } from 'vitest';
     import { parseCsv, serializeCsv } from './csv'; // assuming path

     describe('parseCsv', () => { ... });
     describe('serializeCsv', () => { ... });
     describe('roundtrip', () => { ... });
     ```
   - I'll write the tests inline in the response.

   Let's draft the tests mentally:
   ```typescript
   describe('parseCsv', () => {
     it('parses basic rows', () => {
       expect(parseCsv('a,b\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
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
     it('ignores trailing newlines', () => {
       expect(parseCsv('a,b\n\n')).toEqual([['a', 'b']]);
     });
     it('handles \r\n line endings', () => {
       expect(parseCsv('a,b\r\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
     });
     it('handles \r line endings', () => {
       expect(parseCsv('a,b\rc,d')).toEqual([['a', 'b'], ['c', 'd']]);
     });
     it('handles empty input', () => {
       expect(parseCsv('')).toEqual([]);
     });
     it('handles single field', () => {
       expect(parseCsv('a')).toEqual([['a']]);
     });
     it('handles quoted newlines with \r\n', () => {
       expect(parseCsv('"a\r\nb",c')).toEqual([['a\nb', 'c']]);
     });
   });

   describe('serializeCsv', () => {
     it('serializes basic rows', () => {
       expect(serializeCsv([['a', 'b'], ['c', 'd']])).toBe('a,b\nc,d');
     });
     it('quotes fields with commas', () => {
       expect(serializeCsv([['a,b']])).toBe('"a,b"');
     });
     it('quotes fields with quotes', () => {
       expect(serializeCsv([['a"b']])).toBe('"a""b"');
     });
     it('quotes fields with newlines', () => {
       expect(serializeCsv([['a\nb']])).toBe('"a\nb"');
     });
     it('handles empty fields', () => {
       expect(serializeCsv([['a', '', 'b']])).toBe('a,,b');
     });
   });

   describe('roundtrip', () => {
     it('preserves data through parse and serialize', () => {
       const csv = 'name,age,city\n"Smith, John",30,"New York"\n"Doe, Jane",25,"Los Angeles"\n";",40,"Chicago"';
       const parsed = parseCsv(csv);
       const serialized = serializeCsv(parsed);
       expect(serialized).toBe(csv);
     });
     it('handles complex nested quotes and newlines', () => {
       const csv = '"Line 1\nLine 2","He said ""Hello"""\n"Data, with comma",42';
       const parsed = parseCsv(csv);
       expect(parsed).toEqual([
         ['Line 1\nLine 2', 'He said "Hello"'],
         ['Data, with comma', '42']
       ]);
       expect(serializeCsv(parsed)).toBe(csv);
     });
   });
   ```
   Wait, the roundtrip test for `";",40,"Chicago"` might fail because `parseCsv` trims trailing newlines, but the input doesn't have them. It's fine.
   Let's check `parseCsv('a,b\n\n')` -> returns `[ ['a','b'] ]`. My code removes trailing newlines, so `\n\n` becomes empty string, returns `[]`. Wait! If input is `a,b\n\n`, `replace(/(?:\r?\n)+$/, '')` makes it `a,b`. Then it parses to `[ ['a','b'] ]`. That's correct.
   What about `parseCsv('')` -> returns `[]`. Correct.
   What about `parseCsv('\n')` -> returns `[]`. Correct.
   What about `parseCsv('a\n')` -> returns `[ ['a'] ]`. Correct.

   One edge case: `parseCsv('""')` -> returns `[[]]`. Is that desired? Usually yes.
   Another: `parseCsv('a,b\nc')` (no newline at end) -> `[ ['a','b'], ['c'] ]`. Correct.

   Let's double check the `serializeCsv` roundtrip.
   `serializeCsv([['a', 'b'], ['c', 'd']])` -> `'a,b\nc,d'`. Correct.
   `serializeCsv([['a,b']])` -> `'"a,b"'`. Correct.
   `serializeCsv([['a"b']])` -> `'"a""b"'`. Correct.
   `serializeCsv([['a\nb']])` -> `'"a\nb"'`. Correct.
   `serializeCsv([['a', '', 'b']])` -> `'a,,b'`. Correct.

   One minor thing: `serializeCsv` might need to handle empty rows properly. `[[]]` -> `''`. That's fine.
   What about rows with different lengths? CSV doesn't strictly require fixed lengths, but parsers usually handle it. My code just joins rows independently. That's standard.

   Let's verify the `parseCsv` regex for trailing newlines: `/^(?:\r?\n)+$/` would match only newlines. But I'm using `input.replace(/(?:\r?\n)+$/, '')`. That's fine.

   One potential issue: `parseCsv('"a\nb"')` -> `inQuotes` handles `\n` correctly.
   What about `parseCsv('a,"b\nc",d')`?
   - `a` -> `field='a'`
   - `,` -> `row=['a']`, `field=''`
   - `"` -> `inQuotes=true`
   - `b` -> `field='b'`
   - `\n` -> `field='b\n'`
   - `c` -> `field='b\nc'`
   - `"` -> `inQuotes=false`
   - `,` -> `row=['a','b\nc']`, `field=''`
   - `d` -> `field='d'`
   - End -> `row=['a','b\nc','d']`. Correct.

   All looks solid.

   I will structure the code cleanly with TypeScript types, exports, and vitest tests.
   I'll put everything in a single response as requested.
   I'll make sure to export the functions.
   I'll add the vitest config assumption or just the test file content.

   One detail: `parseCsv` might produce rows with different lengths if fields are missing at the end. That's fine.
   I'll refine `parseCsv` slightly to handle `\r` without `\n` correctly inside quotes? My code does: `} else if (char === '\n' || char === '\r') { field += '\n'; i++; }`. That converts `\r` to `\n` consistently, which is standard.

   Let's write it out carefully.
   I'll also add a check for `input === ''` after trimming trailing newlines to return `[]`.
   Actually, `parseCsv('')` -> `input.replace` -> `''`, returns `[]`. Good.
   `parseCsv('\n')` -> `input.replace` -> `''`, returns `[]`. Good.

   One thing: `serializeCsv` should probably not add a trailing newline, which matches standard behavior.

   Code structure:
   ```typescript
   export function parseCsv(input: string): string[][] { ... }
   export function serializeCsv(rows: string[][]): string { ... }
   ```
   Tests:
   ```typescript
   import { describe, it, expect } from 'vitest';
   import { parseCsv, serializeCsv } from './csv';

   describe('parseCsv', () => { ... });
   // ...
   ```

   I'll produce the final response. All constraints met. Concise, clean TS, comprehensive tests.
   One minor adjustment: In `parseCsv`, when `char === '"'` and `field === ''`, I enter quotes. But what if the field starts with a quote but isn't at the beginning? e.g., `a"b,c`. Standard CSV says quotes only at start of field. My code enforces `field === ''` before entering quotes, which is correct.
   What about `"a"b`? Not valid CSV, but my code would treat `"` as quote, then `a`, then `"b` as literal? Actually, after `inQuotes=false`, it continues. It's fine.

   I'll stick to the implementation. It's robust.
   Final check of the code:
   ```typescript
   export function parseCsv(input: string): string[][] {
     input = input.replace(/(?:\r?\n)+$/, '');
     if (input === '') return [];

     const rows: string[][] = [];
     let row: string[] = [];
     let field = '';
     let inQuotes = false;
     let i = 0;

     while (i < input.length) {
       const char = input[i];
       const nextChar = input[i + 1];

       if (inQuotes) {
         if (char === '"') {
           if (nextChar === '"') {
             field += '"';
             i += 2;
           } else {
             inQuotes = false;
             i++;
           }
         } else if (char === '\r' && nextChar === '\n') {
           field += '\n';
           i += 2;
         } else if (char === '\n' || char === '\r') {
           field += '\n';
           i++;
         } else {
           field += char;
           i++;
         }
       } else {
         if (char === ',') {
           row.push(field);
           field = '';
           i++;
         } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
           row.push(field);
           field = '';
           rows.push(row);
           row = [];
           i += (char === '\r' ? 2 : 1);
         } else if (char === '\r') {
           row.push(field);
           field = '';
           rows.push(row);
           row = [];
           i++;
         } else if (char === '"' && field === '') {
           inQuotes = true;
           i++;
         } else {
           field += char;
           i++;
         }
       }
     }

     row.push(field);
     if (row.length > 0 || rows.length > 0) {
       rows.push(row);
     }

     return rows;
   }
   ```
   Wait, `if (row.length > 0 || rows.length > 0)` at the end will always be true if `rows.length > 0`. If input is just `""`, `rows` is empty, `row` becomes `['']`, pushes `[['']]`. That's correct.
   If input is `a`, `rows` empty, `row` becomes `['a']`, pushes `[['a']]`. Correct.
   If input is `a,b`, `rows` empty, `row` becomes `['a','b']`, pushes `[['a','b']]`. Correct.
   Looks good.

   I'll generate the response now.
   I'll make sure the vitest tests are comprehensive and cover all requested features.
   I'll format it cleanly.
   No extra text.
   Done. 
   One minor thing: `serializeCsv` might want to handle `\r` inside fields by converting to `\n` or keeping it? Standard CSV usually keeps `\r` if present, but `parseCsv` converts `\r` to `\n`. I'll keep it simple: `serializeCsv` just escapes and quotes as needed. If needed, I can normalize `\r` to `\n` in serialize, but it's fine.
   I'll proceed. 
   Output matches response. 
   Self-Correction/Refinement during thought:
   Actually, `parseCsv('a,b\n')` -> `input.replace` -> `'a,b'`. `row` becomes `['a','b']`. `rows` gets `[['a','b']]`. Correct.
   What about `parseCsv('a,b\nc,d')` -> `row` at `\n` becomes `['a','b']`, pushes to `rows`, `row` resets. Then `c,d` processes. At end, `row` is `['c','d']`, pushes to `rows`. Returns `[['a','b'],['c','d']]`. Correct.
   All good.
   I will produce the code now. 
   Structure:
   ```typescript
   // csv.ts
   export function parseCsv(...) { ... }
   export function serializeCsv(...) { ... }

   // csv.test.ts
   import { describe, it, expect } from 'vitest';
   import { parseCsv, serializeCsv } from './csv';
   // tests...
   ```
   Ready. 
   Output matches the final response. 
   Proceeds. 
   [Done] 
   *Self-Correction/Verification during generation prep*:
   I should ensure `serializeCsv` doesn't add a trailing newline, which matches `parseCsv`'s stripping behavior. It doesn't.
   I'll add a test for empty string input returning empty array.
   I'll add a test for mixed line endings.
   I'll make sure the code is strictly TypeScript with proper types.
   All set. 
   Output generation. 
   [Output Generation] -> *Proceeds*

<!-- content (5078 chars) -->
```typescript
// csv.ts
export function parseCsv(input: string): string[][] {
  input = input.replace(/(?:\r?\n)+$/, '');
  if (input === '') return [];

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < input.length) {
    const char = input[i];
    const nextChar = input[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else if (char === '\r' && nextChar === '\n') {
        field += '\n';
        i += 2;
      } else if (char === '\n' || char === '\r') {
        field += '\n';
        i++;
      } else {
        field += char;
        i++;
      }
    } else {
      if (char === ',') {
        row.push(field);
        field = '';
        i++;
      } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
        i += (char === '\r' ? 2 : 1);
      } else if (char === '\r') {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
        i++;
      } else if (char === '"' && field === '') {
        inQuotes = true;
        i++;
      } else {
        field += char;
        i++;
      }
    }
  }

  row.push(field);
  if (row.length > 0 || rows.length > 0) {
    rows.push(row);
  }

  return rows;
}

export function serializeCsv(rows: string[][]): string {
  return rows
    .map(
      (row) =>
        row
          .map((field) => {
            if (/[,"\r\n]/.test(field)) {
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
// csv.test.ts
import { describe, it, expect } from 'vitest';
import { parseCsv, serializeCsv } from './csv';

describe('parseCsv', () => {
  it('parses basic rows', () => {
    expect(parseCsv('a,b\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('handles quoted fields', () => {
    expect(parseCsv('"a,b",c')).toEqual([['a,b', 'c']]);
  });

  it('handles escaped quotes (double-double-quote)', () => {
    expect(parseCsv('"a""b",c')).toEqual([['a"b', 'c']]);
  });

  it('handles newlines inside quoted fields', () => {
    expect(parseCsv('"a\nb",c')).toEqual([['a\nb', 'c']]);
  });

  it('handles empty fields', () => {
    expect(parseCsv('a,,c')).toEqual([['a', '', 'c']]);
  });

  it('ignores trailing newlines', () => {
    expect(parseCsv('a,b\n\n')).toEqual([['a', 'b']]);
    expect(parseCsv('a,b\r\n\r\n')).toEqual([['a', 'b']]);
  });

  it('handles \r\n line endings', () => {
    expect(parseCsv('a,b\r\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('handles \r line endings', () => {
    expect(parseCsv('a,b\rc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('handles empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('handles single field', () => {
    expect(parseCsv('a')).toEqual([['a']]);
  });

  it('handles quoted newlines with \r\n', () => {
    expect(parseCsv('"a\r\nb",c')).toEqual([['a\nb', 'c']]);
  });

  it('preserves trailing empty fields', () => {
    expect(parseCsv('a,b,')).toEqual([['a', 'b', '']]);
  });

  it('handles rows with varying lengths', () => {
    expect(parseCsv('a,b\nc')).toEqual([['a', 'b'], ['c']]);
  });
});

describe('serializeCsv', () => {
  it('serializes basic rows', () => {
    expect(serializeCsv([['a', 'b'], ['c', 'd']])).toBe('a,b\nc,d');
  });

  it('quotes fields containing commas', () => {
    expect(serializeCsv([['a,b']])).toBe('"a,b"');
  });

  it('quotes fields containing quotes', () => {
    expect(serializeCsv([['a"b']])).toBe('"a""b"');
  });

  it('quotes fields containing newlines', () => {
    expect(serializeCsv([['a\nb']])).toBe('"a\nb"');
  });

  it('handles empty fields', () => {
    expect(serializeCsv([['a', '', 'b']])).toBe('a,,b');
  });

  it('handles empty rows', () => {
    expect(serializeCsv([[]])).toBe('');
  });

  it('handles multiple rows with mixed quoting needs', () => {
    expect(serializeCsv([['a', 'b,c'], ['d"e', 'f']])).toBe(
      'a,"b,c"\n"d""e",f'
    );
  });
});

describe('roundtrip', () => {
  it('preserves data through parse and serialize', () => {
    const csv = 'name,age,city\n"Smith, John",30,"New York"\n"Doe, Jane",25,"Los Angeles"';
    const parsed = parseCsv(csv);
    const serialized = serializeCsv(parsed);
    expect(serialized).toBe(csv);
  });

  it('handles complex nested quotes and newlines', () => {
    const csv = '"Line 1\nLine 2","He said ""Hello"""\n"Data, with comma",42';
    const parsed = parseCsv(csv);
    expect(parsed).toEqual([
      ['Line 1\nLine 2', 'He said "Hello"'],
      ['Data, with comma', '42']
    ]);
    expect(serializeCsv(parsed)).toBe(csv);
  });

  it('handles trailing newlines gracefully', () => {
    const csv = 'a,b\n';
    const parsed = parseCsv(csv);
    expect(serializeCsv(parsed)).toBe('a,b');
  });
});
```
