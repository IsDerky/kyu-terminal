import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Tauri espera el servidor en un puerto fijo y que Vite no limpie la consola.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "es2022",
    // Se carga desde disco dentro de la app: un solo archivo grande no penaliza.
    chunkSizeWarningLimit: 1500,
  },
});
