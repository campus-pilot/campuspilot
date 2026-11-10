/**
 * Deterministic randomness for demo seeding. The workflow draws one seed and
 * journals it; every choice is then derived from `(seed, ...scope)`, so a
 * replayed or retried step produces exactly the same data regardless of the
 * order in which other steps ran. Not for secrets: passwords use `node:crypto`.
 */
export type Random = {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number;
  /** True with the given probability. */
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Picks an item with probability proportional to its weight. */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T;
  shuffle<T>(items: readonly T[]): T[];
};

/** cyrb128 string hash: four 32-bit words that seed sfc32. */
function hash128(value: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    h1 = h2 ^ Math.imul(h1 ^ code, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/** Creates a generator keyed by the journaled seed and a stable scope path. */
export function createRandom(seed: string, ...scope: Array<string | number>): Random {
  let [a, b, c, d] = hash128([seed, ...scope].join('\u001f'));
  const next = () => {
    // sfc32
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  // Discard the first outputs, which correlate with the hash state.
  for (let index = 0; index < 12; index += 1) next();

  const random: Random = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (probability) => next() < probability,
    pick: (items) => {
      if (items.length === 0) throw new RangeError('Cannot pick from an empty list.');
      return items[Math.floor(next() * items.length)]!;
    },
    weighted: (items, weight) => {
      const total = items.reduce((sum, item) => sum + weight(item), 0);
      let target = next() * total;
      for (const item of items) {
        target -= weight(item);
        if (target < 0) return item;
      }
      return items[items.length - 1]!;
    },
    shuffle: (items) => {
      const copy = [...items];
      for (let index = copy.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(next() * (index + 1));
        [copy[index], copy[swap]] = [copy[swap]!, copy[index]!];
      }
      return copy;
    },
  };
  return random;
}
