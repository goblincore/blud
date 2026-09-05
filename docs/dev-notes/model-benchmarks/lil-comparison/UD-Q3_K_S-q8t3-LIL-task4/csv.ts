/**
 * CSV parser and serializer.
 *
 * Handles RFC 4180-style CSV with extended support for:
 * - Quoted fields (fields wrapped in double-quotes)
 * - Escaped quotes inside quoted fields (`""` → `"`)
 * - Newlines (LF, CRLF, CR) inside quoted fields
 * - Empty fields (including trailing commas → empty trailing fields)
 * - Trailing newlines in input (ignored)
 */

/** Parse a CSV string into a 2D array of rows and columns. */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        // Look ahead to distinguish escaped quote ("") from closing quote
        if (i + 1 < input.length && input[i + 1] === '"') {
          // Escaped double-quote inside quoted field
          field += '"';
          i += 2;
        } else {
          // Closing quote
          inQuotes = false;
          i++;
        }
      } else {
        // Inside quoted field — accumulate everything, including newlines
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        // Opening quote for a quoted field
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        // End of field — field is not quoted, field ends here
        row.push(field);
        field = '';
        i++;
      } else if (ch === '\r') {
        // Line ending — possibly \r\n
        row.push(field);
        field = '';
        if (i + 1 < input.length && input[i + 1] === '\n') {
          i += 2; // skip \r\n
        } else {
          i += 1; // skip bare \r
        }
        if (row.length > 0 || hasContentLeft(input, i)) {
          rows.push(row);
        }
        row = [];
      } else if (ch === '\n') {
        // Line ending — \n
        row.push(field);
        field = '';
        i++;
        if (row.length > 0 || hasContentLeft(input, i)) {
          rows.push(row);
        }
        row = [];
      } else {
        field += ch;
        i++;
      }
    }
  }

  // Push the last field/row if there's anything left (no trailing newline)
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/** Check whether the remaining input has any meaningful content. */
function hasContentLeft(input: string, offset: number): boolean {
  for (let j = offset; j < input.length; j++) {
    if (input[j] !== '\n' && input[j] !== '\r') {
      return true;
    }
  }
  return false;
}

/**
 * Serialize a 2D array of strings into a CSV text string.
 *
 * All fields are double-quoted to handle edge cases (commas, quotes,
 * newlines, leading/trailing whitespace). Quotes within fields are
 * escaped by doubling them.
 */
export function serializeCsv(rows: string[][]): string {
  const lines: string[] = [];

  for (const row of rows) {
    const fields: string[] = [];
    for (const field of row) {
      // Always quote fields to guarantee round-trip correctness
      const escaped = field.replace(/"/g, '""');
      fields.push(`"${escaped}"`);
    }
    lines.push(fields.join(','));
  }

  return lines.join('\n');
}
