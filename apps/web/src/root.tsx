import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import { SITE_LANGUAGE, SITE_LOGO } from "@/site/seo";

import type { Route } from "./+types/root";

/**
 * The root stays a bare document shell. Each page route owns its own chrome
 * (navigation, footer, theme handling), fonts and stylesheet through its `links`
 * export, so experimental pages such as `/1`–`/3` never inherit another page's
 * global styles or packages.
 */
export const links: Route.LinksFunction = () => [
  // Favicons come from the root `brand/campuspilot` set: the ICO is the fallback, the SVG wins where supported.
  { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
  { rel: "manifest", href: "/site.webmanifest" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={SITE_LANGUAGE} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#f4f4f2" />
        <Meta />
        <meta property="og:logo" content={SITE_LOGO} />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

/** Unstyled on purpose: no route stylesheet is loaded when no route matches. */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;
  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404 ? "The requested page could not be found." : error.statusText || details;
  } else if (error instanceof Error) {
    details = error.message;
  }
  return (
    <main style={{ padding: "64px 16px", fontFamily: "system-ui, sans-serif", maxWidth: 960, margin: "0 auto" }}>
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre style={{ width: "100%", padding: 16, overflowX: "auto" }}>
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
