// csv-reader-speed: a fast drop-in for csv-reader 1.0.0.
//
// Returns exactly what csv-reader 1.0.0 returns for every {text, header}:
// {columns, rows, errors}, following its broken-CSV policy (a U+FEFF at the
// start is dropped; a record ends at LF or CRLF and an empty line is no
// record; outside quotes a CR not followed by LF is dropped with stray_cr;
// a field that opens with a quote runs to the next quote that is not
// doubled, "" inside it is one quote and each CRLF or lone CR inside it is
// read as LF; what follows its closing quote, up to the next comma or line
// break, is appended as it stands with quote_junk; a quote that never
// closes is a literal character and the text after it is read again as
// unquoted with unterminated_quote; a quote inside an unquoted field is a
// literal character; fields stay strings, never trimmed or converted;
// short rows are padded with "", long rows are cut, with short_row and
// long_row errors).
//
// It is fast because it never walks the text a character at a time: an
// unquoted field is found with two indexOf jumps (next comma, next LF) and
// taken as one slice, and a quoted field jumps from quote to quote the same
// way. The slow paths (stray CRs, line breaks inside quotes, junk after a
// closing quote, an unterminated quote) only run when the text actually
// holds them.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** A line break inside quotes: CRLF and a lone CR each read as one LF. */
const QUOTED_BREAK = /\r\n?|\n/g;
/** Doubled quotes inside a quoted field read as one quote. */
const DOUBLED_QUOTE = /""/g;

/**
 * Reads one unquoted field starting at `pos`: the field up to the next comma
 * or line break, or to the end of the text. A CR not followed by LF is
 * dropped (stray_cr, pushed onto `errors` with the record's line/row).
 * Returns [value, ended, added, pos, line]: `value` is `init` plus the
 * field's kept characters, `added` how many characters were kept after
 * `init`, and the position/line after the field's terminator.
 */
function readUnquoted(text, n, pos, line, init, recordLine, recordRow, errors) {
  const ci = text.indexOf(',', pos);
  const ni = text.indexOf('\n', pos);
  let end;
  let ended;
  if (ci === -1 && ni === -1) {
    end = n;
    ended = END;
  } else if (ni === -1 || (ci !== -1 && ci < ni)) {
    end = ci;
    ended = COMMA;
  } else {
    end = ni;
    ended = LINE_BREAK;
  }
  // A CR right before the LF that ends the field is the CRLF line break.
  let rawEnd = end;
  if (ended === LINE_BREAK && end > pos && text.charCodeAt(end - 1) === 13) rawEnd = end - 1;
  let value = text.slice(pos, rawEnd);
  let added = value.length;
  if (value.indexOf('\r') !== -1) {
    // Rare: lone CRs inside the field, each dropped with a stray_cr.
    let out = '';
    let kept = 0;
    let s = 0;
    for (;;) {
      const r = value.indexOf('\r', s);
      if (r === -1) {
        out += value.slice(s);
        kept += value.length - s;
        break;
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      out += value.slice(s, r);
      kept += r - s;
      s = r + 1;
    }
    value = out;
    added = kept;
  }
  if (ended === LINE_BREAK) line += 1;
  return [init + value, ended, added, ended === END ? n : end + 1, line];
}

/** csv-reader 1.0.0's answer for one case's input {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xFEFF) pos = 1;

  // Positions of lone CRs (a CR not followed by LF): each is dropped with a
  // stray_cr wherever it is met outside quotes. Built once per run, so the
  // hot path never scans a field for one; fields are read left to right, so
  // a pointer into this sorted list is all the hot path needs.
  const loneCRs = [];
  {
    let from = 0;
    for (;;) {
      const r = text.indexOf('\r', from);
      if (r === -1) break;
      if (text.charCodeAt(r + 1) !== 10) loneCRs.push(r);
      from = r + 1;
    }
  }
  let lp = 0;
  const loneLen = loneCRs.length;
  // Position of the next LF at or after pos, or -1 when unknown/none: one
  // indexOf per record instead of one per field, since a record's LF stays
  // put while its fields are read (a quoted field that holds LFs moves pos
  // past it, which the check below notices).
  let nlPos = -1;

  let recordLine = 1;
  let recordRow = null;

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else break;
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let ended;
    let lastQuoted = false;
    do {
      let value;
      if (text.charCodeAt(pos) === 34) {
        lastQuoted = true;
        const open = pos;
        const openLine = line;
        let s = pos + 1;
        let closedAt = -1;
        let doubled = false;
        for (;;) {
          const qi = text.indexOf('"', s);
          if (qi === -1) break;
          if (text.charCodeAt(qi + 1) === 34) {
            doubled = true;
            s = qi + 2;
            continue;
          }
          closedAt = qi;
          break;
        }
        if (closedAt === -1) {
          // The quote never closes: it is a literal character, and the text
          // after it is read again as unquoted.
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          const r = readUnquoted(text, n, open + 1, openLine, '"', recordLine, recordRow, errors);
          value = r[0];
          ended = r[1];
          pos = r[3];
          line = r[4];
        } else {
          let content = text.slice(open + 1, closedAt);
          if (content.indexOf('\n') !== -1 || content.indexOf('\r') !== -1) {
            // Each CRLF or lone CR inside quotes is one LF, and counts a line.
            content = content.replace(QUOTED_BREAK, () => {
              line += 1;
              return '\n';
            });
          }
          if (doubled) content = content.replace(DOUBLED_QUOTE, '"');
          pos = closedAt + 1;
          if (pos >= n) {
            value = content;
            ended = END;
          } else {
            const c = text.charCodeAt(pos);
            if (c === 44) {
              pos += 1;
              value = content;
              ended = COMMA;
            } else if (c === 10) {
              pos += 1;
              line += 1;
              value = content;
              ended = LINE_BREAK;
            } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
              pos += 2;
              line += 1;
              value = content;
              ended = LINE_BREAK;
            } else {
              // What follows the closing quote is appended as it stands.
              const r = readUnquoted(text, n, pos, line, content, recordLine, recordRow, errors);
              if (r[2] > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
              value = r[0];
              ended = r[1];
              pos = r[3];
              line = r[4];
            }
          }
        }
      } else {
        lastQuoted = false;
        if (nlPos === -1 || nlPos < pos) nlPos = text.indexOf('\n', pos);
        const ci = text.indexOf(',', pos);
        let end;
        if (ci !== -1 && (nlPos === -1 || ci < nlPos)) {
          end = ci;
          ended = COMMA;
        } else if (nlPos !== -1) {
          end = nlPos;
          ended = LINE_BREAK;
        } else {
          end = n;
          ended = END;
        }
        // A CR right before the LF that ends the field is the CRLF line break.
        let rawEnd = end;
        if (ended === LINE_BREAK && end > pos && text.charCodeAt(end - 1) === 13) rawEnd = end - 1;
        while (lp < loneLen && loneCRs[lp] < pos) lp++;
        if (lp < loneLen && loneCRs[lp] < rawEnd) {
          // Rare: lone CRs inside the field, each dropped with a stray_cr.
          let out = '';
          let s = pos;
          while (lp < loneLen && loneCRs[lp] < rawEnd) {
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
            out += text.slice(s, loneCRs[lp]);
            s = loneCRs[lp] + 1;
            lp++;
          }
          out += text.slice(s, rawEnd);
          value = out;
        } else {
          value = text.slice(pos, rawEnd);
        }
        pos = ended === END ? n : end + 1;
        if (ended === LINE_BREAK) line += 1;
      }
      fields.push(value);
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record.
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
