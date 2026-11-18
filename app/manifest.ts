import type { MetadataRoute } from "next";

// Lets a phone "install" Shortlist to the home screen. There is no offline
// mode: the app needs the network, and the manifest does not pretend otherwise.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Shortlist",
    short_name: "Shortlist",
    description:
      "Three thoughtful introductions a week, from people verified through eLitmus.",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0b5d63",
    categories: ["lifestyle", "social"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
