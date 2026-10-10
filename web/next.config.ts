import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The repo has two package.json files (one at the root for the API, one
// here for the frontend), so Turbopack can't infer which directory is the
// frontend's workspace root. Pin it explicitly to this directory.
const here =
  typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Static export (SPA) — the whole app builds to plain HTML/JS/CSS in `out/`
  // for Cloudflare Pages. Data + auth run client-side; there is no server
  // runtime. See docs/decisions/0001-auth-in-web-layer.md.
  output: "export",
  turbopack: {
    root: here,
  },
};

export default nextConfig;
