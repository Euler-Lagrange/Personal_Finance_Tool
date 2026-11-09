import { build } from "esbuild";

const common = { bundle: true, platform: "node", target: "node22", format: "cjs", external: ["electron"], sourcemap: true, logLevel: "info" };
await build({ ...common, entryPoints: ["src/main/main.ts"], outfile: "dist-electron/main.cjs" });
await build({ ...common, entryPoints: ["src/preload/preload.ts"], outfile: "dist-electron/preload.cjs" });
