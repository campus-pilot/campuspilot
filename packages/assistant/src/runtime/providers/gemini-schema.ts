/**
 * Adapts a JSON Schema to what Gemini's `responseJsonSchema` accepts.
 *
 * Found against the real API (gemini-3.8-flash; `docs/assistant.md`, "Gemini
 * structured output limits"): the documented keyword list is not the whole
 * story. A schema that is too complex is refused with a bare
 * `400 INVALID_ARGUMENT "Request contains an invalid argument."` and nothing
 * else. Two limits were measured, both on the schema **after** `$ref`s are
 * expanded (so `$defs` does not help; the question paper schema is 7 KB with
 * `$defs` and 78 KB expanded):
 *
 * - nesting depth: 30 JSON levels pass, 32 fail (a 2 KB schema);
 * - total complexity: the question paper schema passed with 170 declared
 *   properties and failed with 178 (and with 220, 365 and 884); a flat
 *   object of 150 properties passes, 170 fails. The rule is not documented,
 *   so the adapter stays well inside what passed.
 *
 * The adapter therefore (1) expands local `$ref`s, (2) rewrites `const`, and
 * (3) relaxes the deepest optional subtrees to open schemas until both limits
 * hold. The caller's own validation is the authority on the answer, so a
 * relaxed hint only means the model is not shown the exact shape of rarely
 * used, deeply nested content; it still writes it from the prompt's rules.
 */

/** Depth Gemini was observed to refuse outright on a simple schema (32 fails, 30 passes). */
export const GEMINI_MAX_SCHEMA_DEPTH = 30;

/** The depth the adapter aims for: the question paper schema passed at 19 and failed at 22 (with 178 properties), so there is margin. */
const GEMINI_SCHEMA_DEPTH_BUDGET = 20;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Nesting depth of a JSON value: scalars 0, every array or object adds one level. */
export function jsonDepth(value: unknown): number {
  if (Array.isArray(value)) return 1 + Math.max(0, ...value.map(jsonDepth));
  if (isObject(value)) return 1 + Math.max(0, ...Object.values(value).map(jsonDepth));
  return 0;
}

/** Replaces every local `#/$defs/name` reference by its definition (the schema must not be recursive). */
function inlineReferences(schema: unknown): unknown {
  const defs = isObject(schema) && isObject(schema.$defs) ? schema.$defs : {};
  const expand = (node: unknown, trail: readonly string[]): unknown => {
    if (Array.isArray(node)) return node.map((item) => expand(item, trail));
    if (!isObject(node)) return node;
    if (typeof node.$ref === 'string') {
      const name = node.$ref.replace(/^#\/\$defs\//, '');
      if (trail.includes(name)) throw new Error(`Recursive schema reference ${name} cannot be expanded.`);
      if (!(name in defs)) throw new Error(`Unknown schema reference ${node.$ref}.`);
      return expand(defs[name], [...trail, name]);
    }
    const result: Json = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === '$defs' && trail.length === 0) continue;
      // `properties` is a map of names; a property may be called "$ref" or "const".
      result[key] =
        key === 'properties' && isObject(value)
          ? Object.fromEntries(Object.entries(value).map(([name, property]) => [name, expand(property, trail)]))
          : expand(value, trail);
    }
    return result;
  };
  return expand(schema, []);
}

/**
 * `const` becomes a one-value `enum`; a boolean `const` (`true` flags) is left
 * as a plain boolean, since boolean enums are not supported.
 */
function rewriteConst(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(rewriteConst);
  if (!isObject(node)) return node;
  const result: Json = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'const') {
      if (typeof value === 'string' || typeof value === 'number') result.enum = [value];
    } else if (key === 'properties' && isObject(value)) {
      result[key] = Object.fromEntries(Object.entries(value).map(([name, property]) => [name, rewriteConst(property)]));
    } else {
      result[key] = rewriteConst(value);
    }
  }
  return result;
}

/** Number of declared properties in the expanded schema (the measure of Gemini's complexity limit, see above). */
export function countProperties(value: unknown): number {
  if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + countProperties(item), 0);
  if (!isObject(value)) return 0;
  let total = 0;
  for (const [key, item] of Object.entries(value)) {
    total += key === 'properties' && isObject(item) ? Object.keys(item).length + Object.values(item).reduce<number>((sum, property) => sum + countProperties(property), 0) : countProperties(item);
  }
  return total;
}

type Candidate = { owner: Json; name: string; path: string; depth: number; cost: number };

/** Every optional property that is not already open, with the nesting depth of its own schema and its cost. */
function collectCandidates(node: unknown, depth: number, path: string, found: Candidate[]): void {
  if (Array.isArray(node)) {
    node.forEach((item, index) => collectCandidates(item, depth + 1, `${path}[${index}]`, found));
    return;
  }
  if (!isObject(node)) return;
  const required = new Set(Array.isArray(node.required) ? (node.required as string[]) : []);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'properties' && isObject(value)) {
      for (const [name, property] of Object.entries(value)) {
        const propertyPath = `${path}.${name}`;
        if (!required.has(name) && !isOpen(property)) found.push({ owner: value, name, path: propertyPath, depth: depth + 2, cost: 1 + countProperties(property) });
        collectCandidates(property, depth + 2, propertyPath, found);
      }
    } else {
      collectCandidates(value, depth + 1, key === 'items' ? `${path}[]` : path, found);
    }
  }
}

/** An open schema accepts any JSON; it is what a relaxed property becomes (an array stays an array). */
function open(node: unknown): Json {
  return isObject(node) && node.type === 'array' ? { type: 'array', items: {} } : {};
}

function isOpen(node: unknown): boolean {
  if (!isObject(node)) return true;
  const keys = Object.keys(node);
  if (keys.length === 0) return true;
  return node.type === 'array' && keys.length === 2 && isObject(node.items) && Object.keys(node.items).length === 0;
}

/** A property with fewer declared properties below it than this is a plain field, relaxed only when no subtree is left. */
const MIN_RELAXED_COST = 4;

export type GeminiSchemaLimits = { maxDepth: number; maxProperties: number };

/**
 * The targets are set below what was observed to pass (see the header and
 * `docs/assistant.md`): the question paper schema passed with 170 declared
 * properties at depth 19 and failed with 178 at depth 22, so the budget keeps
 * a margin. The exact rule of the provider is not documented; a new failure
 * means lowering these, which `gemini-schema.test.ts` pins for the real schema.
 */
export const GEMINI_SCHEMA_LIMITS: GeminiSchemaLimits = { maxDepth: GEMINI_SCHEMA_DEPTH_BUDGET, maxProperties: 150 };

export type GeminiSchemaResult = { schema: unknown; relaxed: string[] };

/**
 * Relaxes the deepest optional properties to open schemas (`{}`, any JSON) one
 * at a time, largest first among the deepest, until the schema is within both
 * limits. The top levels keep their full shape, the deepest optional content
 * (parts of parts, captions of figures in options) is written from the
 * prompt's guide instead, and the caller's validation still checks it.
 * Required properties are never relaxed.
 */
export function adaptGeminiResponseSchema(schema: unknown, limits: GeminiSchemaLimits = GEMINI_SCHEMA_LIMITS): GeminiSchemaResult {
  const root = rewriteConst(inlineReferences(schema));
  const relaxed: string[] = [];
  for (;;) {
    if (jsonDepth(root) <= limits.maxDepth && countProperties(root) <= limits.maxProperties) return { schema: root, relaxed };
    const candidates: Candidate[] = [];
    collectCandidates(root, 1, '$', candidates);
    // A subtree (a caption, a list of parts) goes before a single scalar field of a run.
    const subtrees = candidates.filter((candidate) => candidate.cost >= MIN_RELAXED_COST);
    const deepestFirst = (a: Candidate, b: Candidate) => b.depth - a.depth || b.cost - a.cost;
    const next = (subtrees.length > 0 ? subtrees : candidates).sort(deepestFirst)[0];
    if (!next) throw new Error('The response schema is too complex for Gemini even without its optional properties.');
    next.owner[next.name] = open(next.owner[next.name]);
    relaxed.push(next.path);
  }
}

export function toGeminiResponseSchema(schema: unknown): unknown {
  return adaptGeminiResponseSchema(schema).schema;
}
