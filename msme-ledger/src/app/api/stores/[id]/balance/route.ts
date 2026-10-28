// src/app/api/stores/[id]/balance/route.ts
// GET /api/stores/:id/balance — current ledger balance, shown as "Previous Bill Balance" while
// entering a bill. Cashiers may read customer balances only (they appear on printed bills anyway).
import { route, json } from "@/server/http";
import { getStore } from "@/server/services/stores";
import { storeBalance } from "@/server/services/ledger";
import { hasPermission } from "@/server/authorization/permissions";
import { prisma } from "@/server/db";
import { notFound } from "@/server/errors";

type P = { id: string };
export const GET = route<P>("bill:read", async (_req, ctx, { id }) => {
  const s = await getStore(ctx, id);
  if (s.type === "SUPPLIER" && !hasPermission(ctx.role, "bill:create:purchase")) throw notFound("Store");
  return json({ storeId: s.id, balance: (await storeBalance(prisma, ctx.orgId, s.id)).toFixed(2) });
});
