import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: { environment: "node" },
  // Mirrors tsconfig.json's "@/*" path (used by the shadcn ui/ components,
  // e.g. components/ui/tabs.tsx's `import { cn } from "@/lib/utils"`). The
  // app's real Vite config gets this alias for free from
  // @lovable.dev/vite-tanstack-config, but vitest.config.ts here is a
  // separate, minimal config and doesn't inherit it.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
