import type { MetadataRoute } from "next";

// Makes Michael installable: Add to Home Screen on iPhone, Install on Android and desktop Chrome.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Michael",
    short_name: "Michael",
    description: "Michael finds the time you lose every day and gives it back to your goals.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    categories: ["health", "lifestyle"],
    icons: [
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon-180.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
