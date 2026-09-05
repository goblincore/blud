Here's a thinking process:

1.  **Understand User Requirements:**
   - **Function 1:** `parseCsv(input: string): string[][]`
     - Must handle:
       - Quoted fields (double quotes)
       - Escaped quotes (double-double-quote inside quoted fields)
       - Newlines inside quoted fields
       - Empty fields
       - Trailing newlines
   - **Function 2:** `serializeCsv(rows: string[][]): string`
     - Converts a 2D array of strings back to CSV text
   - **Tests:** Comprehensive `vitest` tests with edge cases
   - **Language:** TypeScript
   - **Output:** Clean, working code. No explanations unless asked.

2.  **Design `parseCsv`:**
   - Need to parse CSV character by character or line by line. Character by character is more robust for handling newlines inside quoted fields.
   - State machine approach:
     - States: `IN_FIELD`, `IN_QUOTED_FIELD`, `NEWLINE` (or just track if we're in a quoted field)
     - Actually, simpler: iterate through the string, keep track of current field, current row, and a flag for whether we're inside quotes.
     - Let's define states/variables:
       - `result: string[][]`
       - `currentRow: string[]`
       - `currentField: string`
       - `inQuotes: boolean`
       - `i: number` (index)
     - Loop through each character:
       - If `inQuotes`:
         - If char is `"`:
           - Check next char: if `"` and next char is `"`, it's an escaped quote. Append `"` to `currentField`, skip next char.
           - Else, it's the closing quote. Set `inQuotes = false`.
         - Else, append char to `currentField`.
       - Else (not in quotes):
         - If char is `"`:
           - If it's the start of a quoted field (either at beginning of field or after comma), set `inQuotes = true`.
           - Actually, CSV spec says quotes only valid at the start of a field. I'll handle it robustly: if `"` encountered, toggle `inQuotes` or set it true.
         - If char is `,`:
           - Push `currentField` to `currentRow`, reset `currentField = ""`.
         - If char is `\n` or `\r\n`:
           - Push `currentField` to `currentRow`, push `currentRow` to `result`, reset `currentRow = []`, reset `currentField = ""`. Handle `\r` by skipping if followed by `\n`.
         - Else:
           - Append char to `currentField`.
     - After loop, push remaining `currentField` to `currentRow`, and `currentRow` to `result` if not empty.
     - Handle trailing newlines: if the last row is empty, don't push it (or handle appropriately). The requirement says "trailing newlines", so I should ignore empty trailing rows.
     - Let's refine the state machine to be more precise according to RFC 4180:
       - Fields are separated by commas.
       - Fields may be enclosed in double quotes.
       - Double quotes inside quoted fields are escaped by two double quotes.
       - CRLF is line separator, but LF alone is also common.
       - I'll implement a standard parser.

   Let's draft the parser logic:
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
             currentField += '"';
             i += 2;
           } else {
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
           if (i + 1 < input.length && input[i + 1] === '\n') {
             i++; // skip \n
           }
           currentRow.push(currentField);
           rows.push(currentRow);
           currentRow = [];
           currentField = '';
           i++;
         } else if (char === '\n') {
           currentRow.push(currentField);
           rows.push(currentRow);
           currentRow = [];
           currentField = '';
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

     // Remove trailing empty rows (from trailing newlines)
     while (rows.length > 0 && rows[rows.length - 1].length === 0) {
       rows.pop();
     }

     return rows;
   }
   ```
   Wait, there's a subtle bug: if a field is empty and not quoted, `currentField` is `''`. When we hit a newline, we push it. That's correct.
   But what about the last row logic? If the input ends with a newline, `currentRow` and `currentField` will be empty. The condition `currentField !== '' || currentRow.length > 0` handles it, but I should be careful. Actually, if input ends with `\n`, the loop pushes the row and clears it. Then after loop, `currentRow` is `[]` and `currentField` is `''`, so it won't push an extra empty row. That's good.
   But what if input is just `""`? It should return `[[""]]` or `[[""]]`? Actually, `""` is an empty quoted field, so `[""]`. My code: `inQuotes` becomes true, then immediately false, `currentField` remains `''`. After loop, `currentRow` is `[]`, `currentField` is `''`, so it pushes `['']`. Correct.
   What about `a,b\n`? Loop processes `a`, `,`, `b`, `\n`. Pushes `['a','b']`. After loop, `currentRow` is `[]`, `currentField` is `''`. Correct.
   What about trailing newlines handling? The requirement says "trailing newlines". I'll strip empty trailing rows. But wait, if the CSV has a header and then blank lines, should I keep them? Usually, trailing newlines mean empty rows at the end. I'll strip them. Actually, standard CSV parsers often ignore trailing newlines. I'll keep the logic to pop empty trailing rows.

   Let's test mentally: `a,b\nc,d\n`
   - `a` -> `currentField='a'`
   - `,` -> `currentRow=['a']`, `currentField=''`
   - `b` -> `currentField='b'`
   - `\n` -> `currentRow=['a','b']`, `rows=[['a','b']]`, `currentRow=[]`, `currentField=''`
   - `c` -> `currentField='c'`
   - `,` -> `currentRow=['c']`, `currentField=''`
   - `d` -> `currentField='d'`
   - `\n` -> `currentRow=['c','d']`, `rows=[['a','b'],['c','d']]`, `currentRow=[]`, `currentField=''`
   - End: `currentRow=[]`, `currentField=''` -> doesn't push. Correct.

   What about `a,b\n\nc,d`? (blank line in middle)
   - After first `\n`, `rows=[['a','b']]`, `currentRow=[]`, `currentField=''`
   - Next char is `\n` -> `currentRow.push('')` -> `currentRow=['']`, `rows.push([''])`, `currentRow=[]`, `currentField=''`
   - So blank lines in middle are preserved. Good.
   - Trailing newlines: if input ends with `\n\n`, after first `\n` we have `rows=[...,'']`, after second `\n` we have `rows=[...,'','']`. The cleanup loop `while (rows.length > 0 && rows[rows.length - 1].length === 0) rows.pop();` will remove them. Good.

   One edge case: `""` (empty quoted field) vs `""` (two quotes). My code handles `""` as empty field. If input is `""`, `inQuotes` toggles, `currentField` remains `''`. After loop, pushes `['']`. Correct.
   What about `"a""b"`? `inQuotes=true`, `a` appended, `"` found, next is `"`, so `currentField += '"'`, skip 2. `b` appended, `"` found, next is end or non-`"`, so `inQuotes=false`. Result `a"b`. Correct.

   One minor issue: `char === '\r'` handling. If `\r` is followed by `\n`, I skip `\n`. But what if `\r` is at end of string? `i + 1 < input.length` check handles it. I'll push row on `\r` regardless.
   Actually, RFC 4180 says CRLF is line separator. I'll handle `\r` and `\n` properly.
   Let's adjust the newline handling slightly to be robust:
   ```typescript
         } else if (char === '\r') {
           if (i + 1 < input.length && input[i + 1] === '\n') i++;
           currentRow.push(currentField);
           rows.push(currentRow);
           currentRow = [];
           currentField = '';
           i++;
         } else if (char === '\n') {
           currentRow.push(currentField);
           rows.push(currentRow);
           currentRow = [];
           currentField = '';
           i++;
         }
   ```
   This works.

   Wait, what about fields that contain newlines but aren't quoted? CSV spec says newlines should only appear inside quoted fields. I'll assume valid CSV where newlines only appear in quoted fields, but my parser handles unquoted newlines by ending the row anyway, which is standard behavior.

   Let's refine `parseCsv` to be production-ready:
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
             currentField += '"';
             i += 2;
           } else {
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
           if (i + 1 < input.length && input[i + 1] === '\n') i++;
           currentRow.push(currentField);
           rows.push(currentRow);
           currentRow = [];
           currentField = '';
           i++;
         } else if (char === '\n') {
           currentRow.push(currentField);
           rows.push(currentRow);
           currentRow = [];
           currentField = '';
           i++;
         } else {
           currentField += char;
           i++;
         }
       }
     }

     if (currentField !== '' || currentRow.length > 0) {
       currentRow.push(currentField);
       rows.push(currentRow);
     }

     while (rows.length > 0 && rows[rows.length - 1].length === 0) {
       rows.pop();
     }

     return rows;
   }
   ```
   Actually, `currentRow.length > 0` in the condition might push an empty row if the file ends with a newline but `currentRow` was already pushed. Wait, when `\n` is processed, `currentRow` is pushed and then set to `[]`. So after loop, `currentRow` is `[]`. The condition `currentField !== '' || currentRow.length > 0` will be false. So it won't push an extra empty row. That's correct.
   But what if the input is just `""`? `currentField` is `''`, `currentRow` is `[]`. Condition false. It returns `[]`. That's wrong. `""` should return `[[""]]`.
   Let's fix the end condition:
   Actually, if the file ends without a newline, we need to push the last row. If it ends with a newline, the last row was already pushed.
   Better logic:
   ```typescript
     // Push remaining field and row if not already pushed
     if (i > 0) {
       currentRow.push(currentField);
       rows.push(currentRow);
     }
   ```
   Wait, if input is `a,b\n`, after `\n`, `rows` has `['a','b']`, `currentRow` is `[]`, `currentField` is `''`, `i` is at end. `i > 0` is true, so it pushes `[]` to `rows`. Then trailing newline removal pops it. That works.
   But if input is `""`, `i` goes from 0 to 2. `i > 0` is true. Pushes `['']`. Correct.
   Let's stick with `if (currentField !== '' || currentRow.length > 0)` but initialize `currentRow` as `[]`. Actually, the standard way is:
   ```typescript
     if (currentField !== '' || currentRow.length > 0 || rows.length === 0) {
       // Wait, this is getting messy.
   ```
   Let's just use a flag or check if we need to push. Actually, simpler: always push at the end, then filter trailing empty rows.
   ```typescript
     currentRow.push(currentField);
     rows.push(currentRow);

     while (rows.length > 0 && rows[rows.length - 1].length === 0) {
       rows.pop();
     }
   ```
   If input is `a,b\n`, after loop: `currentRow` is `[]`, `currentField` is `''`. Pushes `[]`. Then pops it. Result `[["a","b"]]`. Correct.
   If input is `""`, after loop: `currentRow` is `[]`, `currentField` is `''`. Pushes `[]`. Wait, `""` should be `[[""]]`, not `[[]]`. Because `""` is a field containing an empty string. My code sets `inQuotes=true`, then immediately false, `currentField` remains `''`. So `currentRow` is `[]`, `currentField` is `''`. Pushing gives `[[]]`. That's wrong. It should be `[[""]]`.
   The issue is that `""` is a valid field. When we encounter `"`, we set `inQuotes=true`. Then immediately `"`, we set `inQuotes=false`. `currentField` is still `''`. But it *is* a field. The parser should recognize that a quoted field, even if empty, is still a field.
   Actually, in CSV, `""` means a field with value `""` (empty string). It's equivalent to `,` or just empty field. But technically, `parseCsv('""')` should return `[[""]]`.
   How to fix? I can track if we've started a field. Or just change the end condition to:
   ```typescript
     if (currentField !== '' || currentRow.length > 0 || (i > 0 && !inQuotes)) {
       currentRow.push(currentField);
       rows.push(currentRow);
     }
   ```
   Actually, simpler: just always push, but handle the `""` case by checking if `currentRow` is empty but we had a quoted field? No.
   Let's think: `""` -> `inQuotes` toggles. `currentField` is `''`. `currentRow` is `[]`. After loop, we push `[]`. We want `[[""]]`.
   The issue is that `currentRow` is empty because we never hit a comma or newline. But `""` represents a single field.
   I'll change the end logic to:
   ```typescript
     if (currentRow.length === 0 && currentField === '') {
       // Only push if there was at least some content or we started a field
       if (i > 0) {
         rows.push(['']);
       }
     } else {
       currentRow.push(currentField);
       rows.push(currentRow);
     }
   ```
   Wait, that's hacky. Let's just use a simpler approach: track `hasField` or just always push `currentRow` with `currentField`, but initialize `currentRow`