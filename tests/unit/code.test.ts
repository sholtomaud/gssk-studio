import { execFileSync } from 'node:child_process';
import { tsc } from '@tsrs/wasm';
import { describe, expect, it } from 'vitest';
import { toProblem } from '../../src/code/diagnostics.ts';
import { dataUrl, executeScript } from '../../src/code/execute.ts';
import { link, LinkError } from '../../src/code/module-graph.ts';
import {
  PROJECT_ROOT,
  projectFiles,
  SCRIPT,
  SCRIPT_JS,
  toAbsolute,
  toRelative,
} from '../../src/code/project.ts';
import { EXAMPLES } from '../../src/model/examples/index.ts';
import { normaliseModel, serialiseModel } from '../../src/model/io.ts';
import { cloneModel } from '../../src/model/types.ts';
import { toEnergese } from '../../src/sdk/energese/codegen.ts';

/** What the compiler worker does, with the real tsrs, in Node. */
async function compile(script: string) {
  const r = await tsc(['-p', toAbsolute('tsconfig.json')], {
    cwd: PROJECT_ROOT,
    files: projectFiles(script),
    diagnostics: 'json',
  });
  const modules: Record<string, string> = {};
  for (const [p, t] of Object.entries(r.files ?? {})) {
    if (!p.includes('/node_modules/')) modules[toRelative(p)] = t;
  }
  return { problems: (r.diagnostics ?? []).map(toProblem), modules };
}

const SLOW = 60_000;

describe('compiling and running scripts (FR-SDK-006, ADR 0011)', () => {
  for (const ex of EXAMPLES) {
    it(
      `${ex.id}: its generated code type-checks under tsrs and runs to the same model`,
      async () => {
        const model = normaliseModel(cloneModel(ex.model)).model;
        const { _observations, ...structure } = model;
        const { problems, modules } = await compile(toEnergese(model));
        expect(problems).toEqual([]);
        expect(Object.keys(modules)).toEqual([SCRIPT_JS]);
        expect(serialiseModel(await executeScript({ modules }, dataUrl))).toBe(
          serialiseModel(structure)
        );
        expect(serialiseModel(await executeScript({ modules, previous: model }, dataUrl))).toBe(
          serialiseModel(model)
        );
      },
      SLOW
    );
  }

  it(
    'reports type errors at their line and column, against the SDK’s real types',
    async () => {
      const { problems } = await compile(
        [
          "import * as ener from 'energese';",
          "const m = new ener.Model('X');",
          "new ener.Storage(m, 'A', { valu: 2 });",
          "fetch('https://example.com');",
          'export default m;',
        ].join('\n')
      );
      expect(problems.map((p) => [p.file, p.startLineNumber, p.severity])).toEqual([
        [SCRIPT, 3, 'error'],
        [SCRIPT, 4, 'error'],
      ]);
      expect(problems[0]!.message).toMatch(/'valu' does not exist/);
      // The sandbox's types have no network: fetch is not declared.
      expect(problems[1]!.message).toMatch(/Cannot find name 'fetch'/);
    },
    SLOW
  );

  it(
    'imports the neutral builder as @gssk/builder',
    async () => {
      const { problems, modules } = await compile(
        [
          "import { GsskModel } from '@gssk/builder';",
          "const m = new GsskModel('Neutral');",
          "const s = m.addNode('source', 'S', { value: 1 });",
          "m.addEdge(s, m.addNode('storage', 'T'), 'linear', { k: 0.1 });",
          'export default m;',
        ].join('\n')
      );
      expect(problems).toEqual([]);
      const built = await executeScript({ modules }, dataUrl);
      expect(built.nodes.map((n) => n.id)).toEqual(['s', 't']);
    },
    SLOW
  );

  it('refuses a script that does not default-export a model', async () => {
    const modules = { [SCRIPT_JS]: 'export default 42;' };
    await expect(executeScript({ modules }, dataUrl)).rejects.toThrow(/default-export its model/);
  });

  it(
    'keeps the SDK types the compiler is given in step with the SDK',
    () => {
      execFileSync(process.execPath, ['scripts/sdk-types.ts', '--check'], { stdio: 'pipe' });
    },
    SLOW
  );
});

describe('linking (ADR 0011)', () => {
  const urls: Record<string, string> = {};
  const toUrl = (path: string, code: string) => {
    urls[path] = code;
    return `mem:${path}`;
  };
  const sdk = { energese: 'mem:sdk' };

  it('links relative imports, dependencies first, and maps the SDK', () => {
    const entry = link(
      {
        'dist/a.js': "import { b } from './lib/b.js';\nimport * as e from 'energese';",
        'dist/lib/b.js': "export const b = 1; export * from '../c.js';",
        'dist/c.js': 'export const c = 2;',
      },
      'dist/a.js',
      toUrl,
      sdk
    );
    expect(entry).toBe('mem:dist/a.js');
    expect(urls['dist/a.js']).toContain("from 'mem:dist/lib/b.js'");
    expect(urls['dist/a.js']).toContain("from 'mem:sdk'");
    expect(urls['dist/lib/b.js']).toContain("from 'mem:dist/c.js'");
  });

  it('refuses any other package or URL, and circular imports', () => {
    const one = (code: string) => link({ 'dist/a.js': code }, 'dist/a.js', toUrl, sdk);
    expect(() => one("import x from 'lodash';")).toThrow(LinkError);
    expect(() => one("await import('https://example.com/x.js');")).toThrow(/not “https:/);
    expect(() =>
      link(
        { 'dist/a.js': "import './b.js';", 'dist/b.js': "import './a.js';" },
        'dist/a.js',
        toUrl,
        sdk
      )
    ).toThrow(/Circular/);
  });
});

describe('diagnostics', () => {
  it('maps tsrs positions to Monaco ranges, widening an empty one', () => {
    expect(
      toProblem({
        fileName: toAbsolute(SCRIPT),
        startPosition: { line: 2, character: 4 },
        endPosition: { line: 2, character: 4 },
        code: 2322,
        category: 1,
        text: 'nope',
      })
    ).toEqual({
      file: SCRIPT,
      severity: 'error',
      code: 2322,
      message: 'nope',
      startLineNumber: 3,
      startColumn: 5,
      endLineNumber: 3,
      endColumn: 6,
    });
  });
});
