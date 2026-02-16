import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";

const mono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "CryptoFlicker",
  description: "Rapid-fire crypto chart screener",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${mono.variable} font-mono antialiased bg-[#0a0a0a] text-[#d4d4d4]`}
      >
        {children}
      </body>
    </html>
  );
}
