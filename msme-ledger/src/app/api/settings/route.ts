// src/app/api/settings/route.ts
// GET /api/settings   PATCH /api/settings
import { z } from "zod";
import { route, json, readJson } from "@/server/http";
import { getSettings, updateSettings } from "@/server/services/admin";

export const GET = route("settings:manage", async (_req, ctx) => json(await getSettings(ctx)));
// Only the keys sent are changed; the merged result is fully validated by updateSettings().
// (A .partial() schema with defaults could silently reset unspecified settings.)
const Patch = z.looseObject({ orgName: z.string().trim().min(2).max(120).optional() });
export const PATCH = route("settings:manage", async (req, ctx) => json(await updateSettings(ctx, (await readJson(req, Patch)) as Parameters<typeof updateSettings>[1])));
