import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// The app lives in app/ so the old single-file app at the repo root keeps working until cut-over.
// base "./" lets the same build run at the site root or under a sub-path such as /emirates-loop/next/.
export default defineConfig({
  root: "app",
  base: "./",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "es2022",
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: { three: ["three"], maplibre: ["maplibre-gl"] },
      },
    },
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: ["icons/*.png", "icons/*.svg"],
      manifest: {
        id: "./",
        name: "Emirates Loop",
        short_name: "Emirates Loop",
        description: "Ride the Emirates Loop indoors with your speed, cadence and heart-rate sensors.",
        start_url: "./",
        scope: "./",
        display: "fullscreen",
        display_override: ["fullscreen", "standalone"],
        orientation: "any",
        background_color: "#0F1417",
        theme_color: "#0F1417",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,json,woff2}"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: "index.html",
        runtimeCaching: [
          {
            // Map style, vector tiles, glyphs and sprites
            urlPattern: ({ url }) => url.hostname === "tiles.openfreemap.org",
            handler: "StaleWhileRevalidate",
            options: { cacheName: "map-tiles", expiration: { maxEntries: 4000, maxAgeSeconds: 60 * 60 * 24 * 60 } },
          },
          {
            // Elevation tiles
            urlPattern: ({ url }) => url.hostname === "s3.amazonaws.com" && url.pathname.startsWith("/elevation-tiles-prod/"),
            handler: "CacheFirst",
            options: { cacheName: "elevation", expiration: { maxEntries: 3000, maxAgeSeconds: 60 * 60 * 24 * 180 } },
          },
          {
            urlPattern: ({ url }) => url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com",
            handler: "CacheFirst",
            options: { cacheName: "fonts", expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
    }),
  ],
});
