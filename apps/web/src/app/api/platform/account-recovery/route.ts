import { recoveryDecisions } from "@/server/auth/recoveryRoutes";
export const dynamic = "force-dynamic";
export const GET = recoveryDecisions(true);
export const POST = recoveryDecisions(true);
