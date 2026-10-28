// src/app/api/inventory/route.ts
// GET /api/inventory?asOf=  or ?from=&to= (range view)
import { z } from "zod";
import { route, json, readQuery } from "@/server/http";
import { isoDate } from "@/lib/validation/common";
import { stockForRange, stockSummary } from "@/server/services/inventory";
import { invalid } from "@/server/errors";

const Q = z.object({ asOf: isoDate.optional(), from: isoDate.optional(), to: isoDate.optional() });
export const GET = route("inventory:read", async (req, ctx) => {
  const q = readQuery(req, Q);
  if (q.from || q.to) {
    if (!q.from || !q.to || q.from > q.to) throw invalid("Give a valid from/to range");
    return json({ mode: "range", rows: await stockForRange(ctx, q.from, q.to) });
  }
  return json({ mode: "asOf", rows: await stockSummary(ctx, q.asOf) });
});
