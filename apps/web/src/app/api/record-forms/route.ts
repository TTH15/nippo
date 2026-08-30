import { NextRequest } from "next/server";
export const dynamic = "force-dynamic";
import { endpoint, bootstrap, saveForm } from "@/server/recordForms/service";
export const GET = (req: NextRequest) => endpoint(() => bootstrap(req));
export const POST = (req: NextRequest) => endpoint(() => saveForm(req));
