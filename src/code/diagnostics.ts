/**
 * tsrs JSON diagnostics (0-based lines, UTF-16 columns) as the 1-based ranges
 * Monaco markers use. After tsrs-monaco (MIT). DOM-free, so unit-tested.
 */
import { toRelative } from './project.ts';

export interface TsrsDiagnostic {
  fileName?: string;
  startPosition?: { line: number; character: number };
  endPosition?: { line: number; character: number };
  code: number;
  category: number;
  text: string;
}

export type Severity = 'error' | 'warning' | 'info';

export interface Problem {
  file: string | null;
  severity: Severity;
  code: number;
  message: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

/** TypeScript's DiagnosticCategory: 0 warning, 1 error, 2 suggestion, 3 message. */
export function severityOf(category: number): Severity {
  return category === 1 ? 'error' : category === 0 ? 'warning' : 'info';
}

export function toProblem(d: TsrsDiagnostic): Problem {
  const start = d.startPosition ?? { line: 0, character: 0 };
  const end = d.endPosition ?? start;
  const empty = start.line === end.line && start.character === end.character;
  return {
    file: d.fileName ? toRelative(d.fileName) : null,
    severity: severityOf(d.category),
    code: d.code,
    message: d.text,
    startLineNumber: start.line + 1,
    startColumn: start.character + 1,
    endLineNumber: end.line + 1,
    // A zero-width diagnostic gets one character, so its squiggle shows.
    endColumn: end.character + (empty ? 2 : 1),
  };
}
