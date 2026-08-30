"use client";
import { FormUIProvider } from "@/lib/recordForms/context";
import { MEMBERS, ROLE_LABELS } from "./model";
export function PreviewFormUI({children}:{children:React.ReactNode}){return <FormUIProvider value={{preview:true,members:MEMBERS,roles:["admin","operations","accounting"].map(id=>({id,label:ROLE_LABELS[id as keyof typeof ROLE_LABELS],manager:id==="admin"}))}}>{children}</FormUIProvider>;}
