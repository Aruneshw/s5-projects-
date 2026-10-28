// src/app/api/investments/[id]/fund/route.ts
// POST /api/investments/:id/fund — the financier confirms the actual transfer with its reference.
import { route, json, readJson } from "@/server/http";
import { FundSchema } from "@/lib/validation/schemas";
import { confirmFunding } from "@/server/services/discounting";

type P = { id: string };
export const POST = route<P>("investment:fund", async (req, ctx, { id }) => json(await confirmFunding(ctx, id, await readJson(req, FundSchema))));
