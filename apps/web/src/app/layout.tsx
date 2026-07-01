import "./globals.css";
import type { Metadata } from "next";
import TenantThemeProvider from "./components/TenantThemeProvider";

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
        <TenantThemeProvider>
          <div className="bg-glow-1" />
          <div className="bg-glow-2" />
          {children}
        </TenantThemeProvider>
      </body>
    </html>
  );
}
