// scripts/reset-password.ts — last-resort password reset run ON THE SERVER by an administrator.
//   npm run user:reset-password -- <username>
// Prints a one-time reset link (30 minutes). Nothing is sent anywhere.
import "dotenv/config";
import { prisma } from "../src/server/db";
import { newResetToken } from "../src/server/auth/password";

async function main() {
  const username = (process.argv[2] ?? "").trim().toLowerCase();
  if (!username) throw new Error("Usage: npm run user:reset-password -- <username>");
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) throw new Error(`No user named ${username}`);
  const { token, tokenHash } = newResetToken();
  await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 30 * 60_000) } });
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  console.log(`One-time reset link for ${username} (valid 30 minutes):\n${base.replace(/\/$/, "")}/reset-password?token=${token}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
