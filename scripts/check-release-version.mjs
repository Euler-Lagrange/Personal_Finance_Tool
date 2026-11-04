import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const pkg = JSON.parse(await read("package.json"));
const lock = JSON.parse(await read("package-lock.json"));
const tauri = JSON.parse(await read("src-tauri/tauri.conf.json"));
const cargo = await read("src-tauri/Cargo.toml");
const cargoVersion = cargo.match(
  /\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m,
)?.[1];
const versions = [
  pkg.version,
  lock.version,
  lock.packages[""].version,
  tauri.version,
  cargoVersion,
];
if (
  !/^\d+\.\d+\.\d+$/.test(pkg.version) ||
  versions.some((v) => v !== pkg.version)
) {
  throw new Error(
    `Release versions disagree: ${versions.join(", ")}. Update package, lock, Tauri and Cargo together.`,
  );
}
if (tauri.bundle.windows.allowDowngrades !== false) {
  throw new Error("Windows installer must reject version downgrades.");
}
console.log(
  `Release ${pkg.version}: package, lock, Tauri and Cargo agree; installer downgrade protection enabled.`,
);
