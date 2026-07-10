import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Genera un servidor autocontenido para una imagen Docker mínima.
  output: "standalone",
};

export default nextConfig;
