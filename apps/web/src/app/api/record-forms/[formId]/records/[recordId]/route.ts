import { NextRequest } from "next/server";
export const dynamic = "force-dynamic";
import { endpoint, getRecord, saveRecord } from "@/server/recordForms/service";
type Ctx = { params: Promise<{ formId: string; recordId: string }> };
export const GET = (req: NextRequest, ctx: Ctx) =>
  endpoint(async () => {
    const p = await ctx.params;
    return getRecord(req, p.formId, p.recordId);
  });
export const PATCH = (req: NextRequest, ctx: Ctx) =>
  endpoint(async () => {
    const p = await ctx.params;
    return saveRecord(req, p.formId, p.recordId);
  });
