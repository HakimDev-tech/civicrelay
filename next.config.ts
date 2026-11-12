import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["libxml2-wasm"],
  outputFileTracingIncludes: {
    "/*": ["./src/lib/cap/schema/CAP-v1.2.xsd"],
  },
};

export default nextConfig;
