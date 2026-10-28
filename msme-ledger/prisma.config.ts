// prisma.config.ts — Prisma 7 configuration.
// Prisma 7 no longer reads .env automatically, so we load it here with dotenv.
// Docs: https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx --conditions=react-server prisma/seed.ts",
  },
  datasource: {
    // process.env (not prisma's env()) so `prisma generate` — run by `npm ci` — works before .env exists.
    // Commands that touch the database (migrate, seed) still fail clearly if DATABASE_URL is missing.
    url: process.env.DATABASE_URL ?? "",
  },
});
