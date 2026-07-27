import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "rb/mail",
    short_name: "rb/mail",
    description: "One calm inbox for every account.",
    start_url: "/",
    display: "standalone",
    background_color: "#f2efe8",
    theme_color: "#f2efe8",
    orientation: "any",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
