/**
 * Levenberg–Marquardt least squares (FR-CAL-001), pure and unit-tested.
 * The caller supplies residuals r(θ); the Jacobian is estimated by forward
 * differences, so every evaluation can be a real kernel run. Written as a
 * resumable object: `iterate()` does one outer iteration, so the worker can
 * report progress and honour a cancel between iterations.
 */

export type Residuals = (theta: readonly number[]) => number[];

export interface LmOptions {
  maxIterations?: number;
  /** Forward-difference step in θ. */
  h?: number;
  /** Stop when the relative fall in SSE is below this. */
  tolerance?: number;
}

export type LmStop = 'converged' | 'max-iterations' | 'no-progress' | 'running';

export interface LmState {
  theta: number[];
  sse: number;
  iteration: number;
  lambda: number;
  stop: LmStop;
  /** Residual evaluations so far (kernel runs, when r is a model). */
  evaluations: number;
}

const sum = (v: readonly number[]) => v.reduce((a, b) => a + b * b, 0);

/** Solve A x = b by Gaussian elimination with partial pivoting; null if singular. */
export function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i] ?? 0]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]?.[c] ?? 0) > Math.abs(M[p]?.[c] ?? 0)) p = r;
    const pivot = M[p]?.[c] ?? 0;
    if (Math.abs(pivot) < 1e-300) return null;
    [M[c], M[p]] = [M[p] ?? [], M[c] ?? []];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = (M[r]?.[c] ?? 0) / pivot;
      if (f === 0) continue;
      for (let k = c; k <= n; k++) (M[r] as number[])[k] = (M[r]?.[k] ?? 0) - f * (M[c]?.[k] ?? 0);
    }
  }
  return M.map((row, i) => (row[n] ?? 0) / (row[i] ?? 1));
}

/** The inverse of a symmetric positive matrix, or null if singular. */
export function invert(A: number[][]): number[][] | null {
  const n = A.length;
  const cols: number[][] = [];
  for (let j = 0; j < n; j++) {
    const e = Array.from({ length: n }, (_, i) => (i === j ? 1 : 0));
    const x = solve(
      A.map((r) => [...r]),
      e
    );
    if (!x) return null;
    cols.push(x);
  }
  return Array.from({ length: n }, (_, i) => cols.map((c) => c[i] ?? 0));
}

export class LevenbergMarquardt {
  readonly state: LmState;
  private readonly r: Residuals;
  private readonly h: number;
  private readonly tol: number;
  private readonly maxIterations: number;
  private resid: number[];
  /** Last Jacobian, rows = residuals, columns = parameters. */
  jacobian: number[][] = [];

  constructor(r: Residuals, theta0: readonly number[], opts: LmOptions = {}) {
    this.r = r;
    this.h = opts.h ?? 1e-5;
    this.tol = opts.tolerance ?? 1e-10;
    this.maxIterations = opts.maxIterations ?? 50;
    this.resid = r(theta0);
    this.state = {
      theta: [...theta0],
      sse: sum(this.resid),
      iteration: 0,
      lambda: 1e-3,
      stop: 'running',
      evaluations: 1,
    };
  }

  get done(): boolean {
    return this.state.stop !== 'running';
  }

  private jac(theta: readonly number[]): number[][] {
    const J: number[][] = this.resid.map(() => []);
    theta.forEach((_, j) => {
      const t = [...theta];
      const step = this.h * Math.max(1, Math.abs(theta[j] ?? 0));
      t[j] = (t[j] ?? 0) + step;
      const r1 = this.r(t);
      this.state.evaluations++;
      r1.forEach((v, i) => ((J[i] as number[])[j] = (v - (this.resid[i] ?? 0)) / step));
    });
    return J;
  }

  /** One outer iteration: a Jacobian, then damped steps until one lowers the SSE. */
  iterate(): void {
    const s = this.state;
    if (this.done) return;
    if (s.iteration >= this.maxIterations) {
      s.stop = 'max-iterations';
      return;
    }
    s.iteration++;
    const J = this.jac(s.theta);
    this.jacobian = J;
    const p = s.theta.length;
    const JtJ = Array.from({ length: p }, (_, a) =>
      Array.from({ length: p }, (_, b) =>
        J.reduce((acc, row) => acc + (row[a] ?? 0) * (row[b] ?? 0), 0)
      )
    );
    const Jtr = Array.from({ length: p }, (_, a) =>
      J.reduce((acc, row, i) => acc + (row[a] ?? 0) * (this.resid[i] ?? 0), 0)
    );
    for (let attempt = 0; attempt < 12; attempt++) {
      const A = JtJ.map((row, i) =>
        row.map((v, j) => (i === j ? v + s.lambda * Math.max(v, 1e-12) : v))
      );
      const delta = solve(
        A,
        Jtr.map((v) => -v)
      );
      if (!delta) {
        s.lambda *= 10;
        continue;
      }
      const trial = s.theta.map((v, i) => v + (delta[i] ?? 0));
      const r1 = this.r(trial);
      s.evaluations++;
      const sse1 = sum(r1);
      if (Number.isFinite(sse1) && sse1 < s.sse) {
        const fall = (s.sse - sse1) / Math.max(s.sse, 1e-300);
        s.theta = trial;
        s.sse = sse1;
        this.resid = r1;
        s.lambda = Math.max(s.lambda / 3, 1e-12);
        if (fall < this.tol || sse1 < 1e-24) s.stop = 'converged';
        return;
      }
      s.lambda *= 4;
    }
    s.stop = 'no-progress';
  }

  /**
   * Linearised standard errors of θ at the current point, σ²(JᵀJ)⁻¹ with
   * σ² = SSE / (n − p). Null when there are no spare observations or JᵀJ is
   * singular (a parameter the data do not inform).
   */
  standardErrors(): number[] | null {
    const J = this.jac(this.state.theta);
    const n = J.length;
    const p = this.state.theta.length;
    if (n <= p) return null;
    const JtJ = Array.from({ length: p }, (_, a) =>
      Array.from({ length: p }, (_, b) =>
        J.reduce((acc, row) => acc + (row[a] ?? 0) * (row[b] ?? 0), 0)
      )
    );
    const inv = invert(JtJ);
    if (!inv) return null;
    const s2 = this.state.sse / (n - p);
    return inv.map((row, i) => Math.sqrt(Math.max(0, (row[i] ?? 0) * s2)));
  }
}
