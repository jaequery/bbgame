import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev badge sits on top of the HUD's bottom-left view card.
  devIndicators: false,
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
