import type { Metadata } from "next";
import { Unbounded } from "next/font/google";
import "./globals.css";
import { InstallPrompt } from "@/app/components/InstallPrompt";
import { NotificationsProvider } from "@/app/components/NotificationsProvider";
import { ToastProvider } from "@/app/components/ToastProvider";
import { ThemeProvider } from "@/app/components/ThemeProvider";

const unbounded = Unbounded({
  subsets: ["latin"],
  weight: ["400", "600", "700", "900"],
  variable: "--font-unbounded",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Tifo — Fantasy Football",
  description: "Fantasy Football. Stadion-Feeling.",
  applicationName: "Tifo",
  appleWebApp: {
    capable: true,
    title: "Tifo",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de" className={unbounded.variable}>
      <head>
        <meta name="theme-color" content="#0c0900" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        {/* Apple splash screens — one per supported device */}
        <link rel="apple-touch-startup-image"
              media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3)"
              href="/splash/apple-splash-iphone-x-11pro-12mini-13mini.png" />
        <link rel="apple-touch-startup-image"
              media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)"
              href="/splash/apple-splash-iphone-12-13-14.png" />
        <link rel="apple-touch-startup-image"
              media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)"
              href="/splash/apple-splash-iphone-14pro-max-15-pro-max.png" />
        <link rel="apple-touch-startup-image"
              media="(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2)"
              href="/splash/apple-splash-ipad-air-11.png" />
        <link rel="apple-touch-startup-image"
              media="(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2)"
              href="/splash/apple-splash-ipad-pro-13.png" />
      </head>
      <body className="min-h-full flex flex-col antialiased">
        <ThemeProvider>
          <ToastProvider>
            <NotificationsProvider>
              {children}
              <InstallPrompt />
            </NotificationsProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
