// Vite build configuration.
// `base: "./"` makes every built asset reference (JS, CSS, favicon) relative
// instead of root-absolute, so the built site works when deployed into a
// server subfolder (e.g. /public_html/ARGPredict/) rather than a domain root.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
});
