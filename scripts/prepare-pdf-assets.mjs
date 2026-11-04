import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
// Copy only renderer support files. No financial files or runtime downloads.
const source = resolve("node_modules/pdfjs-dist");
const destination = resolve("public/pdf-assets");
await mkdir(destination, { recursive: true });
for (const name of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  await cp(resolve(source, name), resolve(destination, name), { recursive: true });
}
await cp(resolve(source, "LICENSE"), resolve(destination, "LICENSE"));
