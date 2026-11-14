import type { Distribution } from './types'

export type Rng = () => number

export function makeRng(seed: number): Rng {
  let a = seed >>> 0 || 0x9e3779b9
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function standardNormal(rng: Rng): number {
  let u = 0
  while (u === 0) u = rng()
  const v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function gamma(rng: Rng, k: number, theta: number): number {
  if (k < 1) return gamma(rng, k + 1, theta) * Math.pow(rng() || 1e-12, 1 / k)
  const d = k - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  for (;;) {
    let x: number
    let v: number
    do {
      x = standardNormal(rng)
      v = 1 + c * x
    } while (v <= 0)
    v = v * v * v
    const u = rng()
    if (u < 1 - 0.0331 * x ** 4) return d * v * theta
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * theta
  }
}

/** Draws a non-negative duration in seconds. */
export function sample(d: Distribution, rng: Rng): number {
  const mean = Math.max(0, d.mean || 0)
  switch (d.type) {
    case 'fixed':
      return mean
    case 'exponential':
      return mean <= 0 ? 0 : -Math.log(1 - rng()) * mean
    case 'normal': {
      const sd = Math.max(0, d.sd ?? 0)
      for (let i = 0; i < 20; i++) {
        const x = mean + sd * standardNormal(rng)
        if (x >= 0) return x
      }
      return mean
    }
    case 'uniform': {
      const lo = Math.max(0, d.min ?? 0)
      const hi = Math.max(lo, d.max ?? lo)
      return lo + (hi - lo) * rng()
    }
    case 'triangular': {
      const a = Math.max(0, d.min ?? 0)
      const b = Math.max(a, d.max ?? a)
      const c = Math.min(b, Math.max(a, d.mode ?? mean))
      if (b === a) return a
      const u = rng()
      const f = (c - a) / (b - a)
      return u < f ? a + Math.sqrt(u * (b - a) * (c - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - c))
    }
    case 'lognormal': {
      if (mean <= 0) return 0
      const sd = Math.max(0, d.sd ?? 0)
      const s2 = Math.log(1 + (sd * sd) / (mean * mean))
      const mu = Math.log(mean) - s2 / 2
      return Math.exp(mu + Math.sqrt(s2) * standardNormal(rng))
    }
    case 'gamma': {
      if (mean <= 0) return 0
      const sd = Math.max(1e-9, d.sd ?? mean)
      const k = (mean / sd) ** 2
      const theta = (sd * sd) / mean
      return gamma(rng, k, theta)
    }
  }
}

/** Expected value of a distribution in seconds. */
export function expected(d: Distribution): number {
  switch (d.type) {
    case 'uniform':
      return ((d.min ?? 0) + (d.max ?? 0)) / 2
    case 'triangular':
      return ((d.min ?? 0) + (d.max ?? 0) + (d.mode ?? d.mean)) / 3
    default:
      return d.mean
  }
}

function mix32(h: number): number {
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

/** 32-bit hash of a seed, a string key and integers. */
export function hash32(seed: number, key: string, ...ints: number[]): number {
  let h = (0x811c9dc5 ^ mix32(seed >>> 0)) >>> 0
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0
  for (const n of ints) h = mix32((h ^ mix32((n >>> 0) + 0x9e3779b9)) >>> 0)
  return h
}

/** Small fast counter generator (sfc32) with 128-bit state. */
export function sfc32(a: number, b: number, c: number, d: number): Rng {
  let x = a >>> 0
  let y = b >>> 0
  let z = c >>> 0
  let w = d >>> 0
  const next = () => {
    const t = (((x + y) >>> 0) + w) >>> 0
    w = (w + 1) >>> 0
    x = y ^ (y >>> 9)
    y = (z + (z << 3)) >>> 0
    z = ((z << 21) | (z >>> 11)) >>> 0
    z = (z + t) >>> 0
    return t
  }
  for (let i = 0; i < 12; i++) next()
  return () => next() / 4294967296
}

export type RngMode = 'keyed' | 'single'

/**
 * Random numbers for the simulation. In `keyed` mode (default) the k-th draw of a source
 * (for example an activity) for a given case comes from its own stream, so it stays the same
 * when other parts of the scenario change: common random numbers across scenarios.
 * `single` uses one stream for everything, as in earlier versions.
 */
export function randomSource(seed: number, mode: RngMode = 'keyed') {
  const s = seed >>> 0 || 1
  if (mode === 'single') {
    const rng = makeRng(s)
    return (key: string, caseId: number): Rng => (void key, void caseId, rng)
  }
  const count = new Map<string, number>()
  return (key: string, caseId: number): Rng => {
    const k = key + '|' + caseId
    const n = count.get(k) ?? 0
    count.set(k, n + 1)
    return sfc32(hash32(s, key, caseId, n, 1), hash32(s, key, caseId, n, 2), hash32(s, key, caseId, n, 3), hash32(s, key, caseId, n, 4))
  }
}
