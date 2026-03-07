import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "F1 Timing Replay",
  description: "Formula 1 race replay and telemetry visualization",
  icons: {
    icon: "/favicon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-f1-dark text-f1-text antialiased">{children}</body>
    </html>
  );
}
