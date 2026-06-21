import { config } from "dotenv";
config({ path: ".env.local" });
import { defineConfig } from "drizzle-kit";

// Mirror src/db/index.ts: the Supabase password contains literal `%` chars,
// which break URL parsing unless percent-encoded. drizzle-kit reads the raw
// DATABASE_URL, so encode it here too.
function encodePasswordInUrl(url: string): string {
  const match = url.match(/^(postgresql:\/\/[^:]+:)([^@]+)(@.+)$/);
  if (!match) return url;
  return match[1] + encodeURIComponent(match[2]) + match[3];
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: encodePasswordInUrl(process.env.DATABASE_URL!),
  },
});
