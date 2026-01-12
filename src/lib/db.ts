import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { Resource } from "sst";

const sql = neon(Resource.DatabaseUrl.value);
export const db = drizzle(sql);
