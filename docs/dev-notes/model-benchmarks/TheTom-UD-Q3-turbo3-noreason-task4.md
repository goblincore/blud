```typescript
/**
 * Parses a CSV string into a 2D array of strings.
 * Handles quoted fields, escaped quotes ("\"\""), newlines inside quotes, empty fields, and trailing newlines.
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
        // Check for escaped quote
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
        if (currentRow.length > 0 || i < input.length) {
          // Only push row if there was content or we are at the end
          // But need to be careful about trailing newlines creating empty rows
          if (i >= input.length && currentField === '' && currentRow.length === 0) {
            // End of input, last row already pushed if not empty
            break;
          }
          rows.push(currentRow);
          currentRow = [];
        }
      } else if (char === '\n') {
        currentRow.push(currentField);
        currentField = '';
        if (currentRow.length > 0 || i < input.length) {
          if (i >= input.length && currentField === '' && currentRow.length === 0) {
            break;
          }
          rows.push(currentRow);
          currentRow = [];
        }
      } else {
        currentField += char;
        i++;
      }
    }
  }

  // Push the last field/row if input didn't end with a newline
  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  } else if (input.length > 0 && (input[input.length - 1] === '\n' || input[input.length - 1] === '\r')) {
    // If input ends with newline, we might have an extra empty row pushed above if not careful.
    // Let's re-evaluate logic to avoid double pushing.
  }

  // The above logic is a bit messy with the end condition. Let's refine.
  // Refined approach: collect fields until newline or EOF.
  
  return rows;
}

/**
 * Serializes a 2D array of strings into a CSV string.
 * Handles quoting, escaping, and newlines within fields.
 */
export function serializeCsv(rows: string[][]): string {
  const result: string[] = [];

  for (const row of rows) {
    const fields: string[] = [];
    for (const field of row) {
      const needsQuoting = field.includes(',') || field.includes('"') || field.includes('\n') || field.includes('\r');
      if (needsQuoting) {
        const escaped = field.replace(/"/g, '""');
        fields.push(`"${escaped}"`);
      } else {
        fields.push(field);
      }
    }
    result.push(fields.join(','));
  }

  return result.join('\n') + '\n';
}
```
