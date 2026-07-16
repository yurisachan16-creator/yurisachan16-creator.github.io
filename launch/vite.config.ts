import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const launchRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: launchRoot,
  publicDir: false,
  resolve: {
    alias: [
      {
        find: /^three$/,
        replacement: resolve(launchRoot, "../node_modules/three/src/Three.js"),
      },
    ],
  },
  plugins: [
    {
      name: "launch-external-draco-decoder",
      enforce: "pre",
      transform(code, id) {
        if (!id.split("?")[0]?.endsWith("/loaders/DRACOLoader.js")) return null;
        // r185 embeds five decoder payloads through import.meta.url. This site
        // always calls setDecoderPath() with the verified public decoder, so
        // retaining those unused defaults would add ~1.7 MB to the app chunk.
        return code
          .replace(
            /const WASM_BIN_URL = .*?;\n/,
            "const WASM_BIN_URL = '';\n",
          )
          .replace(
            /const WASM_JS_URL = .*?;\n/,
            "const WASM_JS_URL = '';\n",
          )
          .replace(/const JS_URL = .*?;\n/, "const JS_URL = '';\n")
          .replace(
            /const DRACO_GLTF_CONFIG = \{[\s\S]*?\n\};/,
            "const DRACO_GLTF_CONFIG = { js: '', wasm: '' };",
          );
      },
    },
  ],
  build: {
    target: "es2022",
    outDir: resolve(launchRoot, "../public/assets/launch/assets"),
    emptyOutDir: false,
    modulePreload: false,
    sourcemap: false,
    minify: "terser",
    terserOptions: {
      compress: {
        passes: 1,
        inline: false,
        reduce_vars: false,
      },
      mangle: true,
      format: {
        comments: false,
      },
    },
    manifest: "vite-manifest.json",
    license: {
      fileName: "THIRD_PARTY_LICENSES.txt",
    },
    lib: {
      entry: resolve(launchRoot, "src/entry.ts"),
      formats: ["es"],
    },
    rollupOptions: {
      output: {
        entryFileNames: "runtime.[hash].js",
        chunkFileNames: "chunks/[name].[hash].js",
        assetFileNames: "runtime.[hash][extname]",
      },
    },
  },
});
