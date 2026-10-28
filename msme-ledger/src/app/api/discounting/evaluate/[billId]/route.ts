// src/app/api/discounting/evaluate/[billId]/route.ts
// GET /api/discounting/evaluate/:billId — eligibility + pricing quote (nothing is saved).
import { route, json } from "@/server/http";
import { validateInvoiceForDiscounting } from "@/server/services/discounting";

type P = { billId: string };
export const GET = route<P>("discount:request", async (_req, ctx, { billId }) => json(await validateInvoiceForDiscounting(ctx, billId)));
