import { customAlphabet } from "nanoid";
import { z } from "zod/v4";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 21);

export const PREFIX_MAP = {
  class: "cls",
  section: "sec",
  school: "sch",
  schoolSession: "sess",
} as const;

export type EntityName = keyof typeof PREFIX_MAP;

export function generateId(entity: EntityName): string {
  return `${PREFIX_MAP[entity]}_${nanoid()}`;
}

const schemaCache = new Map<EntityName, z.ZodString>();

export function entityIdSchema(entity: EntityName) {
  let cached = schemaCache.get(entity);

  if (!cached) {
    const prefix = PREFIX_MAP[entity];
    cached = z.string().regex(
      new RegExp(`^${prefix}_[a-z0-9]{21}$`),
      `Invalid ${entity} ID — expected prefix "${prefix}_"`,
    );
    schemaCache.set(entity, cached);
  }

  return cached;
}

const allPrefixes = Object.values(PREFIX_MAP);
const anyEntityPattern = new RegExp(
  `^(${allPrefixes.join("|")})_[a-z0-9]{21}$`,
);

export function anyEntityIdSchema() {
  return z.string().regex(anyEntityPattern, "Invalid entity ID");
}
