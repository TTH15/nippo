// "next/link" の差し替え。本番パスをプレビューのURLに変換し、pushState で遷移する。
import { forwardRef, type AnchorHTMLAttributes, type MouseEvent } from "react";
import { getPreviewRuntime } from "./runtime";
import { toPreviewHref } from "./paths";

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string | { pathname?: string; query?: Record<string, string> };
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
};

function hrefToString(href: LinkProps["href"]): string {
  if (typeof href === "string") return href;
  const query = href.query ? `?${new URLSearchParams(href.query).toString()}` : "";
  return `${href.pathname ?? "/admin"}${query}`;
}

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link({ href, onClick, prefetch: _p, replace: _r, scroll: _s, ...props }, ref) {
  const target = hrefToString(href);
  return (
    <a
      {...props}
      ref={ref}
      href={toPreviewHref(target, getPreviewRuntime().search)}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.button !== 0) return;
        event.preventDefault();
        getPreviewRuntime().navigate(target);
      }}
    />
  );
});

export default Link;
