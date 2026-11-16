import { defineConfig } from "vite";
import { resolve } from "path";

// Three HTML entry points: the transparent always-on-top pet overlay (index.html),
// the dashboard (dashboard.html) and the right-click popover (popover.html).
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        dashboard: resolve(__dirname, "dashboard.html"),
        popover: resolve(__dirname, "popover.html"),
      },
    },
  },
});
