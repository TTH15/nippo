"use client";
import { createContext, useContext, type AnchorHTMLAttributes, type ImgHTMLAttributes } from "react";

// 実画面のリンクや画像を、認証・Next Routerに依存しない表示に差し替える。
export const PreviewNavigation = createContext<(href: string) => void>(() => {});
export function PreviewLink({ href = "/admin", onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const navigate = useContext(PreviewNavigation);
  return <a {...props} href="#" onClick={event => { event.preventDefault(); onClick?.(event); navigate(href); }} />;
}
export function PreviewImage({ priority: _priority, ...props }: ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...props} alt={props.alt ?? ""} />;
}
