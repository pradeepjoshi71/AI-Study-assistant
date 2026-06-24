import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI Study Assistant - Foundation Dashboard",
  description: "Production-ready platform foundation control center.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="bg-glow-1" />
        <div className="bg-glow-2" />
        {children}
      </body>
    </html>
  );
}
