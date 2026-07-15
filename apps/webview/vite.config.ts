import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    assetsDir: ".",
    emptyOutDir: true,
    outDir: "../extension/dist/webview",
    rolldownOptions: {
      output: {
        assetFileNames: "main[extname]",
        chunkFileNames: "[name].js",
        entryFileNames: "main.js",
      },
    },
  },
});
