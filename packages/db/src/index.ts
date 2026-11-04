import { env } from "@campuspilot/env/server";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

import * as schema from "./schema";

/** A Drizzle database with its own pg pool (`$client`), which owners must end. */
export type Database = NodePgDatabase<typeof schema> & { $client: Pool };
export type DatabaseTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];
export type DatabaseExecutor = Database | DatabaseTransaction;

export function createDb(): Database {
  return drizzle(env.DATABASE_URL, { schema });
}

export const db = createDb();
