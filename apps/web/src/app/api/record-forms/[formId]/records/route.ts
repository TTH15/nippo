import { NextRequest } from "next/server";
export const dynamic = "force-dynamic";
import {
  endpoint,
  listRecords,
  saveRecord,
} from "@/server/recordForms/service";
type Ctx = { params: Promise<{ formId: string }> };
export const GET = (req: NextRequest, ctx: Ctx) =>
  endpoint(async () => listRecords(req, (await ctx.params).formId));
export const POST = (req: NextRequest, ctx: Ctx) =>
  endpoint(async () => saveRecord(req, (await ctx.params).formId));
