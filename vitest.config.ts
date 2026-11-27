import { defineConfig } from "vitest/config";

// Pruebas del frontal (lo que no depende de Tauri). jsdom por localStorage y window.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
