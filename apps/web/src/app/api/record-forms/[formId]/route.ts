import { NextRequest } from "next/server";
export const dynamic = "force-dynamic";
import { endpoint, saveForm } from "@/server/recordForms/service";
export const PUT = (
  req: NextRequest,
  ctx: { params: Promise<{ formId: string }> },
) => endpoint(async () => saveForm(req, (await ctx.params).formId));
