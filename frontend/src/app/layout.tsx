import type { Metadata, Viewport } from "next";
import "./globals.css";
import AuthGate from "@/components/AuthGate";
import { PaywallOverlay } from "@/components/PaywallNotice";

export const metadata: Metadata = {
  title: "F1 Replay Timing",
  description: "Formula 1 race replay and telemetry visualization",
  icons: {
    icon: "/favicon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-f1-dark text-f1-text antialiased">
        <AuthGate>
          {children}
          <PaywallOverlay />
        </AuthGate>
      </body>
    </html>
  );
}
