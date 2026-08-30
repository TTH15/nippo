"use client";
import Builder from "@/lib/recordForms/FormBuilder";
import { PreviewFormUI } from "./context";
export default function FormBuilder(props:React.ComponentProps<typeof Builder>){return <PreviewFormUI><Builder {...props}/></PreviewFormUI>;}
