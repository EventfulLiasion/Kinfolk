import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kinfolk — close, wherever",
  description: "A private space for you and your people.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
