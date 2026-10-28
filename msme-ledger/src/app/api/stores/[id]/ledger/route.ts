// src/app/api/stores/[id]/ledger/route.ts
// GET /api/stores/:id/ledger?from=&to= — running-balance history (ledger is the source of truth).
import { z } from "zod";
import { route, json, readQuery } from "@/server/http";
import { isoDate } from "@/lib/validation/common";
import { storeLedger } from "@/server/services/ledger";

type P = { id: string };
const Q = z.object({ from: isoDate.optional(), to: isoDate.optional() });
export const GET = route<P>("ledger:read", async (req, ctx, { id }) => json(await storeLedger(ctx, id, readQuery(req, Q))));
