import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nippo",
    short_name: "Nippo",
    description: "配送日報集計システム",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#0f2a52",
    icons: [
      {
        src: "/logo/favicon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}

