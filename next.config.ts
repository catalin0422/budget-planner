import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // node:sqlite foloseste binding-uri native; fara asta Turbopack incearca sa-l
  // bundleze pentru Server Components si pica cu "require is not defined".
  serverExternalPackages: ["node:sqlite"],
};

export default nextConfig;
