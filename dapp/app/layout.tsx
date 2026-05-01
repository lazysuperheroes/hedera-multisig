import type { Metadata } from "next";
import { Geist, Geist_Mono, Heebo, Unbounded } from "next/font/google";
import "./globals.css";
import { NavBar } from "../components/NavBar";
import { ThemeProvider } from "../contexts/ThemeContext";

// Geist — kept as fallback + dev-register face (functional, terminal-adjacent)
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Heebo — LSH umbrella body face (treasury register)
const heebo = Heebo({
  variable: "--font-heebo",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

// Unbounded — LSH umbrella display face (treasury register headings)
const unbounded = Unbounded({
  variable: "--font-unbounded",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Hedera MultiSig — by Lazy Superheroes",
  description:
    "Multi-signature transaction coordination on Hedera. Threshold signatures, agent automation, scheduled async signing — keys never leave your device. Hosted by Lazy Superheroes.",
  icons: {
    icon: "https://docs.lazysuperheroes.com/favicon.svg",
    shortcut: "https://docs.lazysuperheroes.com/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Material Symbols Outlined — LSH umbrella icon system. Variable
            font, loads asynchronously, ligature-driven so glyphs render
            once the font is ready. */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${heebo.variable} ${unbounded.variable} antialiased`}
      >
        <ThemeProvider>
          <NavBar />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
