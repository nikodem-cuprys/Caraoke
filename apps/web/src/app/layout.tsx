import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SingLearn",
  description: "Learn to sing any song: synchronized lyrics, isolated vocals, and pitch guidance.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
