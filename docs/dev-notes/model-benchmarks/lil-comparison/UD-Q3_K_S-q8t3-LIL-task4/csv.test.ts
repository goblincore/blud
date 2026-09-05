import { describe, it, expect } from 'vitest';
import { parseCsv, serializeCsv } from './csv';

/* ─── parseCsv ─────────────────────────────────────────── */

describe('parseCsv', () => {
  it('parses a simple 3-column row', () => {
    expect(parseCsv('a,b,c')).toEqual([['a', 'b', 'c']]);
  });

  it('parses two rows', () => {
    expect(parseCsv('a,b\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('handles bare CR line endings', () => {
    expect(parseCsv('a,b\rc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  // ── quoted fields ────────────────────────────────────────

  it('parses a single quoted field', () => {
    expect(parseCsv('"hello",b')).toEqual([['hello', 'b']]);
  });

  it('parses a quoted field with a comma inside', () => {
    expect(parseCsv('a,"one,two",c')).toEqual([['a', 'one,two', 'c']]);
  });

  it('parses multiple quoted fields', () => {
    expect(parseCsv('"a","b","c"')).toEqual([['a', 'b', 'c']]);
  });

  it('parses mixed quoted and unquoted fields', () => {
    expect(parseCsv('unquoted,"qu,oted",third')).toEqual([
      ['unquoted', 'qu,oted', 'third'],
    ]);
  });

  // ── escaped quotes ───────────────────────────────────────

  it('parses escaped double-quote inside quoted field', () => {
    expect(parseCsv('a,"she said ""hi""",b')).toEqual([
      ['a', 'she said "hi"', 'b'],
    ]);
  });

  it('parses multiple escaped quotes', () => {
    expect(parseCsv('"a""b""c"')).toEqual([['a"b"c']]);
  });

  it('parses an empty quoted field', () => {
    expect(parseCsv(',"",')).toEqual([['', '', '']]);
  });

  // ── newlines inside quoted fields ────────────────────────

  it('parses a newline (LF) inside quoted field', () => {
    expect(parseCsv('"line1\nline2",b')).toEqual([['line1\nline2', 'b']]);
  });

  it('parses a newline (CRLF) inside quoted field', () => {
    // CRLF is preserved as-is inside quoted fields
    expect(parseCsv('a,"one\r\ntwo"')).toEqual([['a', 'one\r\ntwo']]);
  });

  it('parses a bare CR inside quoted field', () => {
    expect(parseCsv('"a\rb",c')).toEqual([['a\rb', 'c']]);
  });

  it('parses multiple newlines inside quoted field', () => {
    const input = '"line1\nline2\nline3"';
    expect(parseCsv(input)).toEqual([['line1\nline2\nline3']]);
  });

  // ── empty fields ─────────────────────────────────────────

  it('handles leading comma (empty first field)', () => {
    expect(parseCsv(',b,c')).toEqual([['', 'b', 'c']]);
  });

  it('handles trailing comma (empty last field)', () => {
    expect(parseCsv('a,b,')).toEqual([['a', 'b', '']]);
  });

  it('handles multiple consecutive commas (empty fields)', () => {
    expect(parseCsv('a,,c')).toEqual([['a', '', 'c']]);
  });

  it('handles all-empty fields', () => {
    expect(parseCsv(',,')).toEqual([['', '', '']]);
  });

  it('handles an entirely empty input string', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('handles a single empty field', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('handles a single field with no comma', () => {
    expect(parseCsv('hello')).toEqual([['hello']]);
  });

  // ── trailing newlines ────────────────────────────────────

  it('ignores a trailing newline', () => {
    expect(parseCsv('a,b\n')).toEqual([['a', 'b']]);
  });

  it('ignores trailing CRLF', () => {
    expect(parseCsv('a,b\r\n')).toEqual([['a', 'b']]);
  });

  it('parses blank line as empty row (multiple trailing newlines)', () => {
    // A blank line between content is a row with one empty field
    expect(parseCsv('a,b\n\n')).toEqual([
      ['a', 'b'],
      [''],
    ]);
  });

  it('parses blank line between rows as empty row', () => {
    expect(parseCsv('a,b\n\nc,d')).toEqual([
      ['a', 'b'],
      [''],
      ['c', 'd'],
    ]);
  });

  // ── edge cases ───────────────────────────────────────────

  it('handles empty quoted field in the middle', () => {
    expect(parseCsv('a,"",b')).toEqual([['a', '', 'b']]);
  });

  it('handles quoted field that is only whitespace', () => {
    expect(parseCsv('a,"  ",c')).toEqual([['a', '  ', 'c']]);
  });

  it('handles quoted field containing only a double-quote', () => {
    expect(parseCsv('"""')).toEqual([['"']]);
  });

  it('handles a field starting with a quote but not fully quoted', () => {
    // A bare quote starts a quoted field per RFC 4180
    expect(parseCsv('"abc')).toEqual([['abc']]);
  });

  it('parses a single quoted field with internal CRLF', () => {
    expect(parseCsv('"hello\r\nworld"')).toEqual([['hello\r\nworld']]);
  });

  it('handles quoted field with trailing comma after close-quote', () => {
    expect(parseCsv('"a,b",c')).toEqual([['a,b', 'c']]);
  });

  it('parses a row with a single comma (two empty fields)', () => {
    expect(parseCsv(',')).toEqual([['', '']]);
  });

  it('round-trips empty rows', () => {
    expect(parseCsv('a,b\n\nc,d')).toMatchObject([
      ['a', 'b'],
      [''],
      ['c', 'd'],
    ]);
  });

  it('parses 1000-row CSV without error', () => {
    const lines: string[] = [];
    for (let i = 0; i < 1000; i++) lines.push(`a${i},b${i},c${i}`);
    const csv = lines.join('\n');
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1000);
    expect(rows[500]).toEqual(['a500', 'b500', 'c500']);
  });
});

/* ─── serializeCsv ───────────────────────────────────────── */

describe('serializeCsv', () => {
  it('serializes a single row', () => {
    expect(serializeCsv([['a', 'b', 'c']])).toBe('"a","b","c"');
  });

  it('serializes multiple rows', () => {
    expect(
      serializeCsv([
        ['a', 'b'],
        ['c', 'd'],
      ])
    ).toBe('"a","b"\n"c","d"');
  });

  it('escapes double-quotes in field values', () => {
    expect(serializeCsv([['he said "hi"']])).toBe('"he said ""hi"""');
  });

  it('serializes fields containing commas', () => {
    expect(serializeCsv([['a,b']])).toBe('"a,b"');
  });

  it('serializes fields containing newlines', () => {
    expect(serializeCsv([['line1\nline2']])).toBe('"line1\nline2"');
  });

  it('serializes empty fields', () => {
    expect(serializeCsv([['', 'b', '']])).toBe('"","b",""');
  });

  it('serializes an empty 2D array', () => {
    expect(serializeCsv([])).toBe('');
  });

  it('serializes a row with one empty field', () => {
    expect(serializeCsv([['']])).toBe('""');
  });

  it('serializes fields with leading and trailing whitespace', () => {
    const result = serializeCsv([[' hello ', ' world ']]);
    expect(result).toBe('" hello "," world "');
  });

  it('serializes an empty row (empty field array)', () => {
    // A row with zero fields produces an empty line
    expect(serializeCsv([[]])).toBe('');
  });

  it('serializes rows with string values', () => {
    expect(serializeCsv([['1', '2'], ['3', '4']])).toBe(
      '"1","2"\n"3","4"'
    );
  });

  // ─── round-trip ─────────────────────────────────────────

  it('round-trips a simple table through parseCsv/serializeCsv', () => {
    const input = 'name,age,city\nAlice,30,NYC\nBob,25,LA';
    const rows = parseCsv(input);
    const output = serializeCsv(rows);
    const roundTrip = parseCsv(output);
    expect(roundTrip).toEqual(rows);
  });

  it('round-trips quoted and escaped fields', () => {
    const input = 'a,"she said ""hi""",c';
    const rows = parseCsv(input);
    const output = serializeCsv(rows);
    const roundTrip = parseCsv(output);
    expect(roundTrip).toEqual(rows);
  });

  it('round-trips fields with newlines', () => {
    const input = 'a,"line1\nline2"\nc,d';
    const rows = parseCsv(input);
    const output = serializeCsv(rows);
    const roundTrip = parseCsv(output);
    expect(roundTrip).toEqual(rows);
  });

  it('round-trips empty fields', () => {
    const input = 'a,,c\n,d,e';
    const rows = parseCsv(input);
    const output = serializeCsv(rows);
    const roundTrip = parseCsv(output);
    expect(roundTrip).toEqual(rows);
  });

  it('round-trips trailing newlines (they disappear on re-parse)', () => {
    const input = 'a,b\n';
    const rows = parseCsv(input);
    const output = serializeCsv(rows);
    const roundTrip = parseCsv(output);
    expect(roundTrip).toEqual(rows);
  });
});
