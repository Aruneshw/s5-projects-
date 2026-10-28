// src/app/api/ocr/[id]/route.ts
// DELETE /api/ocr/:id — discard an unconfirmed upload (purges the file).
import { route, json } from "@/server/http";
import { discardUpload } from "@/server/services/ocr";

type P = { id: string };
export const DELETE = route<P>("ocr:use", async (_req, ctx, { id }) => json(await discardUpload(ctx, id)));
