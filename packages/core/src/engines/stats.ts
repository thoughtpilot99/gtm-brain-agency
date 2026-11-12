/** Small, dependency-free statistics helpers. */

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 erf approximation, |err| < 1.5e-7). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** Two-proportion z statistic for x1/n1 vs x2/n2 (pooled). */
export function twoProportionZ(x1: number, n1: number, x2: number, n2: number): number {
  if (n1 === 0 || n2 === 0) return 0;
  const p = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (se === 0) return 0;
  return (x1 / n1 - x2 / n2) / se;
}

export function twoSidedP(z: number): number {
  return 2 * (1 - normalCdf(Math.abs(z)));
}

/** Deterministic PRNG so recommendations are reproducible run to run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/** Gamma(shape, 1) sampler (Marsaglia–Tsang). */
export function sampleGamma(shape: number, rand: () => number): number {
  if (shape < 1) return sampleGamma(shape + 1, rand) * Math.pow(rand(), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = gaussian(rand);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rand();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function sampleBeta(a: number, b: number, rand: () => number): number {
  const x = sampleGamma(a, rand);
  const y = sampleGamma(b, rand);
  return x / (x + y);
}

/** 95% Wilson interval for a proportion. */
export function wilson(x: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.96;
  const p = x / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (centre - margin) / denom), Math.min(1, (centre + margin) / denom)];
}

export const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
export const pct = (n: number, d = 0) => `${round(n * 100, d)}%`;
