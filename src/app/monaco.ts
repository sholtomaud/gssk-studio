/**
 * Monaco without its bundled TypeScript service (ADR 0011), after
 * tsrs-monaco (MIT): the core editor, everyday editing features and
 * TypeScript highlighting. Every diagnostic comes from tsrs. Loaded only with
 * the code view.
 */
import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/features/bracketMatching/register';
import 'monaco-editor/features/clipboard/register';
import 'monaco-editor/features/codeEditor/register';
import 'monaco-editor/features/codicon/register';
import 'monaco-editor/features/comment/register';
import 'monaco-editor/features/contextmenu/register';
import 'monaco-editor/features/cursorUndo/register';
import 'monaco-editor/features/find/register';
import 'monaco-editor/features/folding/register';
import 'monaco-editor/features/gotoError/register';
import 'monaco-editor/features/hover/register';
import 'monaco-editor/features/indentation/register';
import 'monaco-editor/features/linesOperations/register';
import 'monaco-editor/features/multicursor/register';
import 'monaco-editor/features/suggest/register';
import 'monaco-editor/features/wordHighlighter/register';
import 'monaco-editor/features/wordOperations/register';
import 'monaco-editor/languages/definitions/typescript/register';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

/** The editor follows the studio's theme: its own choice, else the system's. */
const dark = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => {
  const t = document.documentElement.dataset.theme;
  monaco.editor.setTheme((t ? t === 'dark' : dark.matches) ? 'vs-dark' : 'vs');
};
dark.addEventListener('change', applyTheme);
new MutationObserver(applyTheme).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-theme'],
});
applyTheme();

export { monaco };
