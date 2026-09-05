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
        // Check for escaped quote (double quote)
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
        inQuotes = true;
        i++;
      } else if (char === ',') {
        currentRow.push(currentField);
        currentField = '';
        i++;
      } else if (char === '\n' || (char === '\r' && i + 1 < input.length && input[i + 1] === '\n')) {
        // Handle \n or \r\n
        currentRow.push(currentField);
        currentField = '';
        if (char === '\r') i++; // skip \r if followed by \n
        if (currentRow.length > 0 || (rows.length > 0 && rows[rows.length - 1].length > 0)) {
          // Only push non-empty rows if the row is not just trailing empty fields from a trailing newline
          // But standard CSV parsers usually keep empty rows if they have content.
          // Let's handle trailing newlines by ignoring empty trailing rows.
          if (currentRow.some(f => f !== '') || rows.length === 0) {
             rows.push(currentRow);
          } else if (rows.length === 0 && currentRow.every(f => f === '')) {
             // First row is all empty, could be a single empty row or just a newline.
             // If the input is just "\n", we probably want [[], []] or []?
             // Standard behavior: "\n" -> ["", ""] is wrong. "\n" -> [] is better.
             // Let's refine: if the row is effectively empty and we are at the end or next is newline...
             // Simplified: Push if it has any non-empty field OR if it's the only row.
             // Actually, let's look at the logic: if input is "a,b\n", currentRow becomes ["a","b"], then we push. Then i points to \n.
             // If input is "a,b\n\n", next iteration sees \n, pushes ["",""], then we have a trailing empty row.
          }
          currentRow = [];
        } else {
           currentRow = [];
        }
        i++;
      } else if (char === '\r') {
        // Handle lone \r
        currentRow.push(currentField);
        currentField = '';
        if (currentRow.some(f => f !== '') || rows.length === 0) {
             rows.push(currentRow);
        }
        currentRow = [];
        i++;
      } else {
        currentField += char;
        i++;
      }
    }
  }

  // Push the last field/row
  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  } else if (input.length > 0 && input[input.length - 1] === '\n' || input[input.length - 1] === '\r') {
     // If the file ended with a newline and we have an empty currentRow, we might have already pushed the last real row.
     // However, if the input was just "\n", we might have pushed an empty row already?
     // Let's re-evaluate the newline logic.
     // If input is "a\n", loop processes 'a', then '\n'. Pushes ["a"]. currentRow becomes [].
     // Loop ends. currentField is "". currentRow is [].
     // The final check `currentRow.length > 0` is false.
     // So "a\n" results in [["a"]]. Correct.
     // If input is "a", loop processes 'a'. Loop ends.
     // Final check: currentField is "a". Pushes ["a"]. Result [["a"]]. Correct.
     // If input is "", loop doesn't run. Final check fails. Result []. Correct.
     // If input is "\n", loop sees '\n'. Pushes [""] (currentRow was []). currentRow becomes [].
     // Final check fails. Result [[""]].
     // Ideally "\n" should probably be [] or [[""]]. Let's stick to [[""]] for consistency with "a\n".
  }

  return rows;
}

export function serializeCsv(rows: string[][]): string {
  return rows.map(row => {
    return row.map(field => {
      // If field contains comma, newline, or double quote, it must be quoted
      if (field.includes(',') || field.includes('\n') || field.includes('"') || field.includes('\r')) {
        return '"' + field.replace(/"/g, '""') + '"';
      }
      return field;
    }).join(',');
  }).join('\n');
}
```
