// src/server/tx.ts
// Every financial mutation goes through withActorTx():
//   1. opens ONE database transaction (all-or-nothing),
//   2. stamps the authenticated actor + organisation into transaction-local settings so the
//      PostgreSQL audit triggers record WHO made the change (see the integrity migration),
//   3. maps database rule violations to friendly 409/422 errors.
import "server-only";
import { prisma, Prisma, type Tx } from "./db";
import { AppError, mapDbError } from "./errors";

export interface ActorContext {
  userId: string;
  orgId: string;
}

export async function setActor(tx: Tx, ctx: ActorContext): Promise<void> {
  await tx.$queryRaw`SELECT set_config('app.actor_id', ${ctx.userId}, true), set_config('app.org_id', ${ctx.orgId}, true)`;
}

export async function withActorTx<T>(
  ctx: ActorContext,
  fn: (tx: Tx) => Promise<T>,
  opts: { serializable?: boolean; timeoutMs?: number } = {},
): Promise<T> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        await setActor(tx, ctx);
        return fn(tx);
      },
      {
        isolationLevel: opts.serializable
          ? Prisma.TransactionIsolationLevel.Serializable
          : Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: opts.timeoutMs ?? 20_000,
        maxWait: 10_000,
      },
    );
  } catch (err) {
    if (err instanceof AppError) throw err;
    const mapped = mapDbError(err);
    if (mapped) throw mapped;
    throw err;
  }
}

/**
 * Serialise all balance-affecting writes for ONE store (bills, payments, adjustments).
 * Transaction-scoped advisory lock: released automatically on commit/rollback.
 * Prevents two devices from computing the same "previous balance" concurrently.
 */
export async function lockStore(tx: Tx, storeId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"store:" + storeId}, 0))`;
}

export async function lockKey(tx: Tx, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}
