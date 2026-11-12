import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GTM Brain",
  description: "One brain per client that every AI agent and every teammate can read.",
};

// Every page reads live data from the local database and brain folders.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        {/* Apply a saved dark theme before paint so the page doesn't flash. */}
        <script dangerouslySetInnerHTML={{ __html: `try{if(localStorage.getItem("gtm-theme")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
