import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

// ES Module equivalent of __dirname
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    // Use Bun's module resolution order for compatibility
    extensions: [".tsx", ".jsx", ".ts", ".mjs", ".js", ".cjs", ".json"],
  },
  css: {
    postcss: "./postcss.config.js",
  },
});
