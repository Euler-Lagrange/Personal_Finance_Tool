# Original PDF viewer - November 3, 2026

## Scope

Adds an offline original-page canvas to Imports, PDF template approval and document application review. PDF.js 6.5.438, its worker, fonts, CMaps, decoders and color profiles ship with the app. The viewer loads on demand, supports page navigation and fit/150%/200% zoom, and keeps the original white page in all themes. It performs no extraction or financial write.

Native reads check workspace/source, type, signature, 10 MB bound and the existing fingerprint. The viewer limits page/image/output sizes, cancels obsolete drawing, and destroys document tasks on collapse/source switch. Scripts, interactive forms and links are not enabled. The content-security policy permits local renderer resources and WASM while retaining restricted network access.

## Findings

- The first evidence-integrity test rejected valid files: the initial comparison used a bare SHA-256 while imports store a format-prefixed fingerprint. The reader now uses the existing fingerprint function. Exact-byte, other-workspace, wrong-type and corrupt-evidence checks pass without financial changes.
- The initial real-renderer test exhausted the generic five-second assertion while the lazy module/worker cold-loaded under CSP. The renderer did eventually display its page; a bounded 15-second ready-state assertion now passes. This is a cold-load timing correction, not an exemption from rendering assertions. A theme screenshot initially caught a repaint; the final capture waits for a nonblank canvas, and Light/Dark crops contain the same 2,651 dark document pixels.
- Real synthetic two-page PDFs render through the actual worker with IPC mocked. A pixel check verifies a nonblank page. Navigation, zoom, local-only network requests, invalid bytes/read failure recovery and collapsed-view cancellation are exercised. Page controls and original documents are checked in light/dark views.

## Checks and delivery

- Full core: **293 passed, 1 explicitly ignored native OCR test**.
- Full browser baseline: **163 passed**. Final focused run: **5 passed**, including a new unsaved-template preservation case; **164 distinct browser cases** now pass across these runs.
- TypeScript, Rustfmt, Prettier, Clippy with warnings denied and Windows release pass. Npm dependency audit reported zero vulnerabilities at installation.
- Real page output and final compact 1100 x 780 Light/Dark screenshots were inspected. The new template case verifies original viewing/navigation does not submit or discard the edited mapping.
- Verified artifact: `builds/Personal Finance Preview - PDF Viewer.exe`, **23,326,208 bytes**, SHA-256 **35BD2CCE6839CF320A0718F6CE3AC2DF1576F47568514EF50DF2F02E034240DF**. Release and delivered copy match. Schema stays 30; prior checkpoints remain available.
- Renderer chunk 454.60 kB / 137.08 kB gzip loads on demand; its worker is 1,271.92 kB. Support assets total about 3.38 MB. Main bundle retains a nonblocking 578.38 kB / 161.07 kB gzip advisory.

## Limits

No personal data or external provider call was used. Native WebView2 rendering and native Explorer/drop/paste interactions remain unverified; browser tests apply the configured CSP but do not certify the packaged native surface. Password-protected or unsupported documents retain original-export/manual handling. This is a read-only canvas, not a PDF editor; extracted text stays available separately. Remaining initial scope: optional reviewed AI, encrypted laptop handoff/packaging and final synthetic integration.
