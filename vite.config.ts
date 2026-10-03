import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  // The CAD lab's STEP converter is a module worker (OpenCascade WASM + glTF writer).
  worker: { format: "es" },
  // Pre-bundle the lab's dependencies at startup: found later (the worker starts on the first drop),
  // the dev server re-optimizes and reloads the page mid-conversion.
  optimizeDeps: {
    include: [
      "occt-import-js",
      "@gltf-transform/core",
      "@gltf-transform/extensions",
      "@gltf-transform/functions",
      "meshoptimizer",
      "three-gpu-pathtracer",
      "three-mesh-bvh",
      "three/examples/jsm/libs/fflate.module.js",
      "three/examples/jsm/libs/meshopt_decoder.module.js",
      "three/examples/jsm/loaders/GLTFLoader.js",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./src"),
    },
  },
});
