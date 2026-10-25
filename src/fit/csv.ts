/**
 * A small CSV reader for observation files (FR-OBS-001): RFC 4180 quoting,
 * comma, semicolon or tab separated, first row headings. In-house (ADR 0001).
 */

export interface Table {
  headers: string[];
  rows: string[][];
}

function detectSeparator(firstLine: string): string {
  const counts = [',', ';', '\t'].map((sep) => [sep, firstLine.split(sep).length] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]?.[0] ?? ',';
}

export function parseCsv(text: string): Table {
  const src = text.replace(/^﻿/, '');
  const sep = detectSeparator(src.split(/\r?\n/, 1)[0] ?? '');
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') {
      quoted = true;
    } else if (c === sep) {
      record.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || record.length) {
    record.push(field);
    records.push(record);
  }
  const nonEmpty = records.filter((r) => r.some((f) => f.trim() !== ''));
  const [headers = [], ...rows] = nonEmpty;
  return { headers: headers.map((h) => h.trim()), rows };
}
