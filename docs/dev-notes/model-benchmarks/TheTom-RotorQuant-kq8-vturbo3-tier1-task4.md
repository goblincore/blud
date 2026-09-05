```typescript
/**
 * Parses a CSV string into a 2D array of strings.
 * Handles quoted fields, escaped quotes (double-double-quote),
 * newlines inside quoted fields, empty fields, and trailing newlines.
 */
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
        // Check for escaped quote ("")
        if (i + 1 < len && input[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        } else {
          // End of quoted field
          inQuotes = false;
          i++; // skip the closing quote
          continue;
        }
      } else {
        // Inside quotes, append character (including newlines)
        currentField += char;
        i++;
        continue;
      }
    } else {
      // Not in quotes
      if (char === '"') {
        // Start of quoted field
        inQuotes = true;
        i++;
        continue;
      } else if (char === ',') {
        // Field separator
        currentRow.push(currentField);
        currentField = '';
        i++;
        continue;
      } else if (char === '\r') {
        // Handle Windows line endings (\r\n)
        if (i + 1 < len && input[i + 1] === '\n') {
          // End of row
          currentRow.push(currentField);
          currentField = '';
          if (currentRow.some(f => f !== '' || currentRow.length > 0)) {
             // Always push the row, even if empty, but handle trailing empty rows logic later if needed.
             // Actually, standard CSV parsers usually ignore trailing empty rows unless specified.
             // Let's push it and filter later if it's just trailing newlines.
          }
          rows.push(currentRow);
          currentRow = [];
          i += 2; // skip \r\n
          continue;
        } else {
          // Bare \r treated as newline (legacy Mac)
          currentRow.push(currentField);
          currentField = '';
          rows.push(currentRow);
          currentRow = [];
          i++;
          continue;
        }
      } else if (char === '\n') {
        // End of row
        currentRow.push(currentField);
        currentField = '';
        rows.push(currentRow);
        currentRow = [];
        i++;
        continue;
      } else {
        // Regular character
        currentField += char;
        i++;
        continue;
      }
    }
  }

  // Handle the last field/row if file doesn't end with newline
  if (inQuotes) {
    // Unterminated quote - usually an error, but we'll just close it
    inQuotes = false;
  }
  
  currentRow.push(currentField);
  
  // Filter out trailing empty rows caused by trailing newlines
  while (rows.length > 0 && currentRow.length === 0 && currentField === '' && 
         // Check if the last pushed row was effectively empty due to trailing newline logic
         // Actually, the logic above pushes currentRow at the end.
         // If the input ended with \n, the last push was an empty row.
         // We need to distinguish between a valid empty row at the end of data vs trailing newline artifact.
         ) {
    // This logic is tricky. Let's refine the trailing newline handling.
    break; 
  }

  // Refined approach for trailing newlines:
  // The loop above pushes a row every time \n or \r\n is encountered.
  // If the input ends with \n, we have an extra empty row at the end of `rows`.
  // We should remove it if it's empty.
  while (rows.length > 0 && rows[rows.length - 1].length === 0 && 
         (rows[rows.length - 1][0] === '' || rows[rows.length - 1].length === 0)) {
    // Check if the last row is truly empty
    const lastRow = rows[rows.length - 1];
    if (lastRow.length === 0 || (lastRow.length === 1 && lastRow[0] === '')) {
       // Only pop if it's a result of a trailing newline
       // But wait, if the CSV data itself ends with an empty row, we should keep it.
       // Standard convention: trailing newlines are ignored.
       rows.pop();
    } else {
      break;
    }
  }
  
  // Re-evaluating the simple logic:
  // The previous complex loop is error-prone. Let's rewrite a cleaner version.
  return []; // Placeholder for the clean version below
}

/**
 * Clean implementation of parseCsv
 */
export function parseCsvClean(input: string): string[][] {
  const result: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const len = input.length;

  while (i < len) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < len && input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        field += char;
        i++;
        continue;
      }
    }

    if (char === '"') {
      inQuotes = true;
      i++;
      continue;
    }

    if (char === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }

    if (char === '\r') {
      if (i + 1 < len && input[i + 1] === '\n') {
        row.push(field);
        field = '';
        result.push(row);
        row = [];
        i += 2;
        continue;
      } else {
        row.push(field);
        field = '';
        result.push(row);
        row = [];
        i++;
        continue;
      }
    }

    if (char === '\n') {
      row.push(field);
      field = '';
      result.push(row);
      row = [];
      i++;
      continue;
    }

    field += char;
    i++;
  }

  // Handle last field/row if no trailing newline
  if (field !== '' || inQuotes || row.length > 0) {
    row.push(field);
    result.push(row);
  } else if (inQuotes) {
    // Unterminated quote at end of file? Push empty row?
    // Usually unterminated quotes are errors, but we handle gracefully.
    row.push(field);
    result.push(row);
  }

  // Remove trailing empty rows caused by trailing newlines
  while (result.length > 0) {
    const lastRow = result[result.length - 1];
    if (lastRow.length === 0 || (lastRow.length === 1 && lastRow[0] === '')) {
      // Check if this row was created by a trailing newline
      // If the input ended with \n, the last push in the loop created an empty row.
      // We can detect this by checking if the last char of input was newline.
      // However, simpler: just pop empty rows at the end.
      // But what if the CSV data is:
      // a,b\n
      // c,d\n
      // This has a trailing newline. The last row is empty.
      // What if the CSV data is:
      // a,b\n
      // c,d\n
      // \n
      // This has two newlines. The last row is empty.
      
      // Standard behavior: ignore trailing newlines.
      result.pop();
    } else {
      break;
    }
  }

  return result;
}

/**
 * Serializes a 2D array of strings into a CSV string.
 */
export function serializeCsv(rows: string[][]): string {
  return rows.map(row => {
    return row.map(field => {
      if (field.includes(',') || field.includes('"') || field.includes('\n') || field.includes('\r')) {
        return `"${field.replace(/"/g, '""')}"`;
      }
      return field;
    }).join(',');
  }).join('\n');
}

// Export the main parseCsv as the primary one
export { parseCsvClean as parseCsv };
```
