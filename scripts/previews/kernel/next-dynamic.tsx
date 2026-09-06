// "next/dynamic" の差し替え。React.lazy + Suspense で同等に振る舞う。
import React, { lazy, Suspense, type ComponentType } from "react";

type Loader<P> = () => Promise<{ default: ComponentType<P> } | ComponentType<P>>;

export default function dynamic<P extends object>(loader: Loader<P>, options?: { loading?: ComponentType; ssr?: boolean }) {
  const Lazy = lazy(async () => {
    const loaded = await loader();
    return "default" in loaded ? loaded : { default: loaded };
  });
  const Loading = options?.loading;
  return function DynamicComponent(props: P) {
    return (
      <Suspense fallback={Loading ? <Loading /> : null}>
        <Lazy {...(props as P & React.JSX.IntrinsicAttributes)} />
      </Suspense>
    );
  };
}
