import type { NextConfig } from "next";

// NEXT_PUBLIC_* values are read at build time: rebuild after changing them.
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3040";
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://rpc.mainnet.fastnear.com";
const FASTFS_GATEWAY = process.env.NEXT_PUBLIC_FASTFS_GATEWAY || "https://main.fastfs.io";
const isDev = process.env.NODE_ENV !== "production";
// The previous near.social app (widgets on SocialDB) now lives here. Read at build time.
const LEGACY_URL = (process.env.LEGACY_NEAR_SOCIAL_URL || "https://legacy.near.social").replace(/\/$/, "");

function origin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

const gatewayOrigin = origin(FASTFS_GATEWAY);
const gatewayHost = (() => {
  try {
    return new URL(FASTFS_GATEWAY).hostname;
  } catch {
    return "main.fastfs.io";
  }
})();

/** Hosts the wallet-selector modules talk to (RPC, bridges, popups/iframes). */
const WALLET_CONNECT = [
  "https://*.fastnear.com",
  "https://*.near.org",
  "https://app.mynearwallet.com",
  "https://*.mynearwallet.com",
  "https://*.meteorwallet.app",
  "wss://*.meteorwallet.app",
  "https://*.herewallet.app",
  "wss://*.herewallet.app",
  "https://h4n.app",
  "wss://h4n.app",
  "https://hot-labs.org",
  "https://*.hot-labs.org",
  "wss://*.hot-labs.org",
  "https://*.intear.tech",
  "wss://*.intear.tech",
];

// A `*.` wildcard doesn't match the apex domain: HOT's widget is served from hot-labs.org itself.
const WALLET_FRAMES = [
  "https://*.intear.tech",
  "https://*.herewallet.app",
  "https://hot-labs.org",
  "https://*.hot-labs.org",
  "https://h4n.app",
  "https://*.meteorwallet.app",
  "https://app.mynearwallet.com",
];

const csp = [
  "default-src 'self'",
  // Next.js inlines hydration scripts; wallet modules need wasm for some crypto.
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`,
  // The wallet-selector modal and Radix set inline styles.
  "style-src 'self' 'unsafe-inline'",
  // User media comes from FastFS; link-card and YouTube thumbnails from near.social's image proxy.
  // HOT's wallet-modal icon is the one other remote exception.
  `img-src 'self' ${gatewayOrigin} https://i.near.social data: blob: https://storage.herewallet.app`,
  "font-src 'self' data:",
  `connect-src 'self' ${origin(API_URL)} ${origin(RPC_URL)} ${gatewayOrigin} ${WALLET_CONNECT.join(" ")}${isDev ? " ws: wss:" : ""}`,
  // YouTube embeds (loaded only after a click).
  `frame-src ${WALLET_FRAMES.join(" ")} https://www.youtube-nocookie.com`,
  "worker-src 'self' blob:",
  `media-src 'self' blob: ${gatewayOrigin}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
]
  .map((d) => d.replace(/\s+/g, " ").trim())
  .join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Not `no-referrer`: YouTube embeds refuse to play without a referrer (error 153).
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  // Wallet popups (MyNearWallet, Intear…) talk back to window.opener.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  // Ledger uses WebHID/WebUSB. Don't restrict autoplay or fullscreen here: the YouTube embed
  // needs both (and the iframe's `allow` can't grant what this header denies).
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), hid=(self), usb=(self)",
  },
  ...(isDev
    ? []
    : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Docker builds set NEXT_OUTPUT=standalone (see Dockerfile).
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // Don't let `next dev` write AGENTS.md / CLAUDE.md into the project.
  agentRules: false,
  // Allow the dev server's HMR socket when browsing via 127.0.0.1.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "main.fastfs.io", pathname: "/**" },
      ...(gatewayHost !== "main.fastfs.io"
        ? [{ protocol: "https" as const, hostname: gatewayHost, pathname: "/**" }]
        : []),
    ],
    // Media paths are content-addressed (sha256), so they never change.
    minimumCacheTTL: 31_536_000,
    formats: ["image/avif", "image/webp"],
    qualities: [75],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // Old near.social URLs go to the legacy app. Temporary (307) redirects for now, so browsers don't
  // cache them forever; the query string (e.g. `?accountId=…`) is carried over.
  // `/{account}`, `/{account}/post/…` etc. are this app's own routes and aren't affected.
  async redirects() {
    return [
      { source: "/:account/widget/:path*", destination: `${LEGACY_URL}/:account/widget/:path*`, permanent: false },
      { source: "/embed/:path*", destination: `${LEGACY_URL}/embed/:path*`, permanent: false },
      { source: "/edit", destination: `${LEGACY_URL}/edit`, permanent: false },
      { source: "/edit/:path*", destination: `${LEGACY_URL}/edit/:path*`, permanent: false },
      { source: "/signin", destination: `${LEGACY_URL}/signin`, permanent: false },
    ];
  },
  // `/magic/…` (e.g. /magic/img/account/{account}, which i.near.social and old widgets call) is
  // proxied, not redirected: callers get the legacy response unchanged (body, 203 status, headers)
  // at the same URL, which also works for fetch() and server-to-server callers that don't follow
  // redirects.
  async rewrites() {
    return {
      beforeFiles: [{ source: "/magic/:path*", destination: `${LEGACY_URL}/magic/:path*` }],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
