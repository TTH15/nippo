"use client";

import ShiftsPage from "../shifts/page";
import { ShiftWorkspaceContext } from "@/lib/shiftMemo/workspace";

export default function ShiftMemosPage() {
  return <ShiftWorkspaceContext.Provider value="memo"><ShiftsPage /></ShiftWorkspaceContext.Provider>;
}
