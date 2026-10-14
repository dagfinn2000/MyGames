import type { MetadataRoute } from "next";

/**
 * PWA web app manifest — makes the app installable on a phone home screen
 * (handy for logging a session from the sofa, controller still warm).
 * Served at /manifest.webmanifest; the middleware exempts it from auth.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MyGames",
    short_name: "MyGames",
    description: "Personal self-hosted video game library and play tracker",
    // The root route sends each player to their chosen start page.
    start_url: "/",
    display: "standalone",
    background_color: "#1e293b",
    theme_color: "#1e293b",
    // Long-press the home-screen icon → jump straight to the games being
    // played, to log time, or to adding a game.
    shortcuts: [
      {
        name: "Now playing",
        short_name: "Playing",
        url: "/playing",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Add a game",
        short_name: "Add",
        url: "/games/new",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
