import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Hello World", description: "A minimal Hello World application" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
