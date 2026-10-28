// src/server/services/items.ts
import "server-only";
import { prisma } from "../db";
import { withActorTx } from "../tx";
import { conflict, notFound } from "../errors";
import { m2 } from "@/lib/money";
import type { SessionContext } from "../auth/session";
import type { z } from "zod";
import { ItemCreateSchema, ItemUpdateSchema } from "@/lib/validation/schemas";

const toDto = (i: { id: string; name: string; unitType: "KG" | "BAG" | "BOX"; cooliePerBag: { toString(): string }; isActive: boolean }) => ({
  id: i.id,
  name: i.name,
  unitType: i.unitType,
  cooliePerBag: m2(i.cooliePerBag),
  isActive: i.isActive,
});

export async function listItems(ctx: Pick<SessionContext, "orgId">, opts: { q?: string; includeInactive?: boolean } = {}) {
  const rows = await prisma.item.findMany({
    where: {
      orgId: ctx.orgId,
      ...(opts.includeInactive ? {} : { isActive: true }),
      ...(opts.q ? { name: { contains: opts.q.trim(), mode: "insensitive" as const } } : {}),
    },
    orderBy: { name: "asc" },
  });
  return rows.map(toDto);
}

export async function createItem(ctx: Pick<SessionContext, "orgId" | "userId">, raw: z.input<typeof ItemCreateSchema>) {
  const input = ItemCreateSchema.parse(raw);
  const dup = await prisma.item.findFirst({ where: { orgId: ctx.orgId, name: { equals: input.name, mode: "insensitive" } } });
  if (dup) throw conflict(`Item "${input.name}" already exists. Use the line mark for grades of the same item.`);
  const item = await withActorTx(ctx, (tx) =>
    tx.item.create({ data: { orgId: ctx.orgId, name: input.name, unitType: input.unitType, cooliePerBag: m2(input.cooliePerBag) } }),
  );
  return toDto(item);
}

/** Unit type is intentionally not editable: existing bill lines depend on it. */
export async function updateItem(ctx: Pick<SessionContext, "orgId" | "userId">, id: string, raw: z.input<typeof ItemUpdateSchema>) {
  const input = ItemUpdateSchema.parse(raw);
  const existing = await prisma.item.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!existing) throw notFound("Item");
  const item = await withActorTx(ctx, (tx) =>
    tx.item.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.cooliePerBag !== undefined ? { cooliePerBag: m2(input.cooliePerBag) } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    }),
  );
  return toDto(item);
}
