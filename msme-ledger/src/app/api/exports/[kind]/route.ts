// src/app/api/exports/[kind]/route.ts
// GET /api/exports/:kind?format=csv|xlsx|pdf|json&from=&to=&fy=
import { z } from "zod";
import { route, readQuery, json } from "@/server/http";
import { isoDate } from "@/lib/validation/common";
import { buildReportTable, REPORT_KINDS, toCsv, toXlsx, type ReportKind } from "@/server/services/exports";
import { fyRange } from "@/server/services/reports";
import { tablePdf } from "@/server/pdf/documents";
import { recordAudit } from "@/server/audit/audit";
import { prisma } from "@/server/db";
import { notFound, invalid } from "@/server/errors";
import { todayIST } from "@/lib/dates";

export const runtime = "nodejs";
type P = { kind: string };
const Q = z.object({ format: z.enum(["csv", "xlsx", "pdf", "json"]).default("csv"), from: isoDate.optional(), to: isoDate.optional(), fy: z.string().regex(/^\d{4}-\d{2}$/).optional() });

export const GET = route<P>("report:export", async (req, ctx, { kind }) => {
  if (!(REPORT_KINDS as readonly string[]).includes(kind)) throw notFound("Report");
  const q = readQuery(req, Q);
  const r = q.fy ? fyRange(q.fy) : { from: q.from ?? `${todayIST().slice(0, 7)}-01`, to: q.to ?? todayIST() };
  if (r.from > r.to) throw invalid("'from' must be on or before 'to'");
  const table = await buildReportTable(ctx, kind as ReportKind, r);
  if (q.format === "json") return json(table); // on-screen view of the same table (not a download)
  await recordAudit(prisma, { orgId: ctx.orgId, actorId: ctx.userId, action: "EXPORT", entityType: "report", entityId: kind, data: { format: q.format, ...r } });
  const base = `${kind}-${r.from}-to-${r.to}`;
  if (q.format === "csv") {
    return new Response(toCsv(table), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${base}.csv"`, "cache-control": "no-store" } });
  }
  if (q.format === "xlsx") {
    const buf = await toXlsx(table);
    return new Response(new Uint8Array(buf), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${base}.xlsx"`, "cache-control": "no-store" } });
  }
  const pdf = await tablePdf(table);
  return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${base}.pdf"`, "cache-control": "no-store" } });
});
