import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    assetsDir: ".",
    emptyOutDir: true,
    outDir: "../extension/dist/webview",
    target: "es2025",
    rolldownOptions: {
      output: {
        assetFileNames: "main[extname]",
        chunkFileNames: "[name].js",
        entryFileNames: "main.js",
      },
    },
  },
});
