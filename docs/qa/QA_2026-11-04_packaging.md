# Windows installer - November 4, 2026

The Windows x64 app now has a per-user NSIS installer. It includes Microsoft's offline WebView2 runtime installer, so setup does not depend on downloading that runtime on the destination PC. Existing compatible WebView2 is reused. `npm run build:installer` builds this package; `build:desktop` still produces the executable without bundling. Downgrades are disabled in the installer configuration. The stable app identifier and financial data location are unchanged.

The first build could not resolve the NSIS download host inside the restricted network. The authorized packaging retry downloaded official Tauri NSIS tooling/plugins (the bundler verified their hashes) and Microsoft's runtime. No installer was executed on Jacob's profile and no financial database was opened for packaging.

Checks passed: production TypeScript/Vite/Rust build and NSIS compilation; source/delivery SHA-256 equality for both artifacts; PE signatures and machine types (x86 installer bootstrap, x64 application); generated installer-script inspection for current-user setup, embedded offline runtime, and data deletion only under the explicit uninstall checkbox. The downloaded Microsoft runtime is 215,017,168 bytes and its Authenticode status is Valid, signed by Microsoft Corporation. Existing schema-35 validation remains **333 core / 186 mocked UI passed**; packaging changed configuration rather than financial behavior.

Delivered artifacts:

- `builds/Personal Finance 0.1.0 Setup.exe`: **226,466,501 bytes**, SHA-256 **8B19303184860708A4256B0EB83900EFE0C88AD128F4D90895D5C848936B5739**.
- `builds/Personal Finance - Trial.exe`: **26,507,264 bytes**, SHA-256 **51CAC9330C7DC85B1BB37D88A1C55EBE173D2F1A453D99ADE4E108A4C4197798**. The bundler adds NSIS metadata, so its hash differs from the previous unbundled handoff checkpoint.

The app/installer have no publisher signing certificate and are unsigned preview artifacts. Installer execution on a clean/offline Windows machine, upgrade/uninstall UI, native WebView browse/drop/paste, real provider/issuer layouts, and a physical second computer remain unverified. Successful build and script inspection do not establish those behaviors. Final synthetic lifecycle checks and the live-trial handoff follow. See `LIVE_TRIAL.md` for the intended user trial.

Configuration follows [Tauri's Windows installer guidance](https://v2.tauri.app/distribute/windows-installer/) and the installed Tauri configuration schema.
