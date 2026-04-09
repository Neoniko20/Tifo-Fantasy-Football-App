import type { NextConfig } from "next";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const withPWA = require("next-pwa")({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  skipWaiting: true,
  fallbacks: {
    document: "/offline",
  },
  runtimeCaching: [
    // Images (players, clubs, TSDB cutouts) — cache-first, long TTL
    {
      urlPattern: /^https?:\/\/www\.thesportsdb\.com\/images\/.*\.(png|jpg|jpeg|webp)$/,
      handler: "CacheFirst",
      options: {
        cacheName: "tsdb-images",
        expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 }, // 30 days
      },
    },
    // API-Football player photos
    {
      urlPattern: /^https?:\/\/media\.api-sports\.io\/.*$/,
      handler: "CacheFirst",
      options: {
        cacheName: "apisports-media",
        expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
      },
    },
    // Next image optimizer output
    {
      urlPattern: /^\/_next\/image\?/,
      handler: "StaleWhileRevalidate",
      options: { cacheName: "next-image", expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 7 } },
    },
    // Google fonts
    {
      urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
      handler: "StaleWhileRevalidate",
      options: { cacheName: "google-fonts", expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 30 } },
    },
    // Supabase REST — network-first with short fallback (live data wins, but offline still reads)
    {
      urlPattern: /\/rest\/v1\/.*/i,
      handler: "NetworkFirst",
      options: {
        cacheName: "supabase-rest",
        networkTimeoutSeconds: 3,
        expiration: { maxEntries: 100, maxAgeSeconds: 60 * 5 },
      },
    },
  ],
});

const nextConfig: NextConfig = {
  turbopack: {},
};

export default withPWA(nextConfig);
