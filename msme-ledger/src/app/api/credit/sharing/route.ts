// src/app/api/credit/sharing/route.ts
// PUT /api/credit/sharing — consent to share an anonymised credit profile with lenders.
import { z } from "zod";
import { route, json, readJson } from "@/server/http";
import { setCreditSharing } from "@/server/services/credit";

export const PUT = route("credit:apply", async (req, ctx) => json(await setCreditSharing(ctx, (await readJson(req, z.object({ share: z.boolean() }))).share)));
