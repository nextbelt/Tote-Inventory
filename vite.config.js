import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 9000,
    open: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.js",
    css: false,
    // Hermetic tests: never construct a real Supabase client
    alias: [
      {
        find: /.*\/lib\/supabase$/,
        replacement: fileURLToPath(
          new URL("./src/test/supabase-mock.js", import.meta.url)
        ),
      },
    ],
  },
});
