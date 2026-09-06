// "next/navigation" の差し替え。App Router のフックをプレビューの runtime に接続する。
import { getPreviewRuntime, usePreviewRuntime } from "./runtime";

export function useRouter() {
  return {
    push: (href: string) => getPreviewRuntime().navigate(href),
    replace: (href: string) => getPreviewRuntime().navigate(href),
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    refresh: () => getPreviewRuntime().store.invalidate(),
    prefetch: () => {},
  };
}

export function usePathname(): string {
  return usePreviewRuntime().pathname;
}

export function useSearchParams(): URLSearchParams {
  const { search } = usePreviewRuntime();
  return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
}

export function useParams(): Record<string, string> {
  return {};
}

export function redirect(href: string): never {
  getPreviewRuntime().navigate(href);
  throw new Error("redirect");
}

export function notFound(): never {
  throw new Error("notFound");
}
