"use client";
import { createContext, useContext } from "react";
import type { FormRole, MemberOption } from "./model";
export type FormUIContext = {
  members: MemberOption[];
  roles: FormRole[];
  preview: boolean;
};
const FormUI = createContext<FormUIContext>({
  members: [],
  roles: [],
  preview: false,
});
export const FormUIProvider = FormUI.Provider;
export const useFormUI = () => useContext(FormUI);
