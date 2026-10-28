// scripts/run-daily-jobs.ts — run the daily maintenance jobs from a terminal or OS scheduler.
//   npm run jobs:daily
import "dotenv/config";
import { runDailyJobs } from "../src/server/jobs/daily";
import { prisma } from "../src/server/db";

runDailyJobs()
  .then((r) => console.log(JSON.stringify(r, null, 2)))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
