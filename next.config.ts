import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // `postgres` usa APIs nativas do Node; não deve ser empacotado pelo bundler.
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
