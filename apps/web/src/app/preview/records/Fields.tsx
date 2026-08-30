"use client";
import { FieldControl as Control } from "@/lib/recordForms/Fields";
import { PreviewFormUI } from "./context";
export {Choice,control,selectStyle} from "@/lib/recordForms/Fields";
export function FieldControl(props:React.ComponentProps<typeof Control>){return <PreviewFormUI><Control {...props}/></PreviewFormUI>;}
