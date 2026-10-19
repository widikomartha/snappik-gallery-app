import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  logging: { incomingRequests: false },
  outputFileTracingIncludes: { "/health/*": ["./src/db/migrations/*.sql"] },
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" }
    ] }];
  }
};
export default config;
