import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { roRO } from "@clerk/localizations";
import "./globals.css";
import Nav from "@/components/Nav";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Budget planner",
  description: "Planificator personal de buget și călătorii",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider localization={roRO}>
      <html lang="ro" className={`h-full antialiased ${inter.variable}`}>
        <body className="min-h-full flex flex-col bg-bg text-ink">
          <Nav />
          <main className="flex-1 max-w-3xl w-full mx-auto px-4 pt-6 pb-28">{children}</main>
        </body>
      </html>
    </ClerkProvider>
  );
}
