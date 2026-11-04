# Original PDF display

Show an explicitly opened original-page preview in the source, template editor and document application editor. The native core reads only the selected workspace/source evidence, checks PDF type, byte signature, the existing 10 MB bound and fingerprint, then returns the original bytes. It does not parse, re-extract, apply a template or write financial data.

Use pinned PDF.js 6.5.438 in a lazy bundle. Build/dev preparation copies its fonts, CMaps, color profiles, decoders and license locally. The worker is bundled by Vite. No remote document URLs, embedded links, scripting layer or editable forms are enabled. CSP allows same-origin renderer assets, worker and WASM plus the existing Tauri IPC; it does not allow arbitrary network hosts or JavaScript eval.

Open at fit width, with explicit page and zoom choices, a scrollable bounded canvas and at most one current rendering. Limit to 100 pages, 25 million pixels per source image and 12 million output-canvas pixels. Destroy loading/worker tasks on collapse/source switch and cancel superseded renders; separate canvases prevent stale drawing. Invalid/encrypted/unsupported documents show a retry or original-export fallback. Extracted text remains accessible separately. Opening a preview never implies import or validates financial values.

Verify actual synthetic PDFs in browser tests with source IPC mocked, real PDF.js workers/assets, nonblank canvas checks, page navigation, zoom, read/parse failure recovery, collapse/unmount cancellation and compact Light/Dark visual inspection. Confirm native evidence isolation/integrity separately with temporary SQLite. Native WebView2/CSP rendering remains an explicit external smoke-test gap until exercised in the packaged app.

Primary renderer references: https://mozilla.github.io/pdf.js/examples/ and https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html .
