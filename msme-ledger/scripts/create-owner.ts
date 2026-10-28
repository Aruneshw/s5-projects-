// scripts/create-owner.ts — first-time production setup: creates the business, its first owner and
// default payment modes. Add Dad and staff afterwards from the Team screen.
//   PowerShell:  $env:NEW_OWNER_PASSWORD="…"; npm run setup:owner -- "Business name" me "Me"
//   bash:        NEW_OWNER_PASSWORD=… npm run setup:owner -- "Business name" me "Me"
// Set ALLOW_WEAK_PASSWORD=1 to skip the strength rules (e.g. a short password).
import "dotenv/config";
import { prisma } from "../src/server/db";
import { hashPassword } from "../src/server/auth/password";
import { withActorTx } from "../src/server/tx";
import { OrgSettingsSchema } from "../src/lib/validation/settings";
import { PasswordSchema } from "../src/lib/validation/schemas";

async function main() {
  const [orgName, usernameRaw, displayName] = process.argv.slice(2);
  if (!orgName || !usernameRaw || !displayName) throw new Error('Usage: npm run setup:owner -- "Business name" <username> "<Display name>"');
  const username = usernameRaw.trim().toLowerCase();
  const rawPassword = process.env.NEW_OWNER_PASSWORD ?? "";
  if (!rawPassword) throw new Error("Set NEW_OWNER_PASSWORD");
  const password = process.env.ALLOW_WEAK_PASSWORD === "1" ? rawPassword : PasswordSchema.parse(rawPassword);
  if (await prisma.user.findUnique({ where: { username } })) throw new Error(`Username ${username} already exists`);
  const user = await prisma.user.create({ data: { username, displayName, passwordHash: await hashPassword(password) } });
  const org = await prisma.organization.create({ data: { name: orgName, settings: OrgSettingsSchema.parse({}) as object } });
  await prisma.membership.create({ data: { userId: user.id, orgId: org.id, role: "MSME_OWNER" } });
  await withActorTx({ userId: user.id, orgId: org.id }, (tx) =>
    tx.paymentMode.createMany({
      data: [
        { orgId: org.id, name: "Cash", isDigital: false },
        { orgId: org.id, name: "UPI", isDigital: true },
        { orgId: org.id, name: "Bank transfer", isDigital: true },
        { orgId: org.id, name: "Cheque (account payee)", isDigital: true },
      ],
    }),
  );
  console.log(`Created "${orgName}" with owner ${username}. Sign in and add other members under Team.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
