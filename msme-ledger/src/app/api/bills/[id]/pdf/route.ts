// src/app/api/bills/[id]/pdf/route.ts
// GET /api/bills/:id/pdf — printable bill (inline) or ?download=1.
import { z } from "zod";
import { route, readQuery } from "@/server/http";
import { getBill } from "@/server/services/bills";
import { billPdf } from "@/server/pdf/documents";

export const runtime = "nodejs";
type P = { id: string };
export const GET = route<P>("bill:print", async (req, ctx, { id }) => {
  const { download } = readQuery(req, z.object({ download: z.enum(["0", "1"]).optional() }));
  const bill = await getBill(ctx, id); // margins are never printed
  const pdf = await billPdf(bill, ctx.orgName);
  const name = `${bill.type === "SALES" ? "sales" : "purchase"}-bill-${bill.billNumber ?? "draft"}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${download === "1" ? "attachment" : "inline"}; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
});
