<!-- thinking (1534 chars) -->

Let me think through this carefully.

I need to implement a CSV parser and serializer in TypeScript with proper handling of:
- Quoted fields (enclosed in double quotes)
- Escaped quotes (double-double-quote "" inside quoted fields)
- Newlines inside quoted fields
- Empty fields
- Trailing newlines

For the parser:
1. I need to track whether I'm currently in a quoted field
2. When in a quoted field, I need to handle:
   - Regular characters (including newlines)
   - Escaped quotes (two consecutive double quotes = one literal quote)
   - The closing quote
3. When not in a quoted field, commas separate fields
4. Need to handle field termination (comma or newline)

For the serializer:
1. Fields containing commas, quotes, or newlines should be quoted
2. Quotes within fields should be escaped as double quotes

Let me verify my understanding of the CSV format:
- Fields are separated by commas
- Fields can be enclosed in double quotes
- Double quotes inside quoted fields are represented as two consecutive double quotes
- Newlines can appear inside quoted fields
- Empty fields are valid
- Trailing newlines should be handled (probably ignored or treated as an empty row)

Edge cases to consider:
- Empty input
- Single field
- Multiple fields
- Fields with commas
- Fields with quotes
- Fields with newlines
- Empty fields (consecutive commas)
- Fields with only spaces
- Fields with leading/trailing spaces
- Empty quoted field
- Quoted field with only quotes
- Fields with mixed content

Let me implement this step by step.

<!-- answer (2561 chars) -->
```typescript
/**
 * Parses CSV text into a 2D array of strings.
 * Handles quoted fields, escaped quotes, newlines inside quoted fields, empty fields, and trailing newlines.
 */
function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  
  if (input.length === 0) return rows;
  
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    
    if (char === '"') {
      if (inQuotes) {
        // Check for escaped quote (double-double-quote)
        if (i + 1 < input.length && input[i + 1] === '"') {
          currentField += '"';
          i++; // Skip the next quote
        } else {
          // End of quoted field
          inQuotes = false;
        }
      } else {
        // Start of quoted field
        inQuotes = true;
      }
    } else if (char === ',' && !inQuotes) {
      // Field separator
      currentRow.push(currentField);
      currentField = '';
    } else if (char === '\n' && !inQuotes) {
      // End of row
      currentRow.push(currentField);
      currentRow.shift(); // Remove empty string added for trailing newline
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
    } else if (char === '\r' && !inQuotes) {
      // Handle CRLF and CR line endings
      if (i + 1 < input.length && input[i + 1] === '\n') {
        i++; // Skip LF after CR
      }
      currentRow.push(currentField);
      currentRow.shift(); // Remove empty string added for trailing newline
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
    } else {
      // Regular character
      currentField += char;
    }
  }
  
  // Handle the last field/row if not ended with newline
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    currentRow.shift(); // Remove empty string added for trailing newline
    rows.push(currentRow);
  }
  
  return rows;
}

/**
 * Serializes a 2D array of strings into CSV text.
 * Properly handles fields containing commas, quotes, and newlines.
 */
function serializeCsv(rows: string[][]): string {
  return rows.map(row => 
    row.map(field => {
      // If field contains comma, quote, or newline, it must be quoted
      if (field.includes(',') || field.includes('"') || field.includes('\n') || field.includes('\r')) {
        return '"' + field.replace(/"/g, '""') + '"';
      }
      return field;
    }).join(',')
  ).join('\n');
}

// Export for testing
export { parseCsv, serializeCsv };
```
