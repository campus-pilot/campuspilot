import { env } from "@campuspilot/env/server";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;
export type DatabaseTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];
export type DatabaseExecutor = Database | DatabaseTransaction;

export function createDb(): Database {
  return drizzle(env.DATABASE_URL, { schema });
}

export const db = createDb();
