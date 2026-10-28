// tests/support/setup.ts — point every test at the dedicated TEST database, never the dev one.
import "dotenv/config";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error("Set TEST_DATABASE_URL in .env (a separate database that tests may wipe)");
if (testUrl === process.env.DATABASE_URL_ORIGINAL) throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL");
process.env.DATABASE_URL_ORIGINAL ??= process.env.DATABASE_URL;
if (testUrl === process.env.DATABASE_URL_ORIGINAL) throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL");
process.env.DATABASE_URL = testUrl;
process.env.NEXTAUTH_SECRET ??= "test-secret-test-secret-test-secret";
process.env.CRON_SECRET ??= "test-cron-secret-0123456789";
