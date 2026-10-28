// src/app/api/stores/[id]/bank/route.ts
// GET/PUT /api/stores/:id/bank — restricted bank details (owners only).
import { route, json, readJson } from "@/server/http";
import { StoreBankSchema } from "@/lib/validation/schemas";
import { getBankDetail, setBankDetail } from "@/server/services/stores";

type P = { id: string };
export const GET = route<P>("store:bank:read", async (_req, ctx, { id }) => json(await getBankDetail(ctx, id)));
export const PUT = route<P>("store:bank:write", async (req, ctx, { id }) => json(await setBankDetail(ctx, id, await readJson(req, StoreBankSchema))));
