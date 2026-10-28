// src/app/api/audit/route.ts
// GET /api/audit?entityType=&entityId=&before= — audit trail (owners).
import { z } from "zod";
import { route, json, readQuery } from "@/server/http";
import { listAudit } from "@/server/services/admin";

const Q = z.object({ entityType: z.string().max(40).optional(), entityId: z.string().max(64).optional(), before: z.string().regex(/^\d+$/).optional() });
export const GET = route("audit:read", async (req, ctx) => json(await listAudit(ctx, readQuery(req, Q))));
