// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig({
  vite: {
    optimizeDeps: {
      include: ["react", "react-dom", "react/jsx-runtime", "@xyflow/react"],
    },
    // Run `ANALYZE=true npm run build` to open an interactive bundle breakdown
    plugins: process.env.ANALYZE
      ? [
          visualizer({
            open: true,
            gzipSize: true,
            filename: "dist/bundle-report.html",
          }),
        ]
      : [],
  },
});
