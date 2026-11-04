# Reviewed AI bill and statement fields - November 3, 2026

Schema 33 adds editable AI bill/statement fields, source quotes and explicit USD/target confirmation. Native previews show prior/new amounts and dates, component arithmetic, calculated statement differences and coverage warnings. Applying once updates the existing obligation and links evidence without creating spending or payment. Original proposals and reviewed corrections remain saved; reopening an applied document shows read-only history.

Shared native guards protect paid bill capacity, card obligations, source account/extraction and stale reviews. Exact evidence fingerprints cannot be applied twice across AI, local PDF templates or repeated observations. Atomic writes, operation receipts and restore validation protect history. AI does not bypass existing accounting checks.

Full suites: **317 core passed, 2 explicitly ignored environment tests; 175 mocked browser passed**. Six new native cases cover consent/arithmetic/quotes, payment changes, rollback, duplicate observations, signed statements and paid obligations, corrupted restores and schema-32 upgrade. Three new UI cases cover corrected previews, delayed results, retained edits, lost-response retries, saved corrections and read retries. TypeScript, Prettier, Rustfmt, Clippy with warnings denied and Windows release pass. Compact light/dark review screens were visually inspected.

Verified artifact: `builds/Personal Finance Preview - AI Documents.exe`, **25,151,488 bytes**, SHA-256 **A28716FD4DFEFB569A86CE1E074B2519D986E02A318DE2A8AB7DA88F0A35F5FC**. Release/copy match. Use this build or newer after schema 33. Main bundle advisory: 607.20 kB / 167.89 kB gzip.

No live provider or financial data was used. Browser IPC remains mocked; native tests use temporary SQLite stores. Actual model/issuer accuracy, Windows WebView drop/paste and second-device checks remain unverified. Declarative AI mapping/template suggestions continue next, followed by encrypted handoff/packaging and final synthetic integration. The initial scope remains incomplete.

The fault-injection test fails at audit insertion after the obligation changes; the transaction restores prior source revision, evidence and bill values. Corrupted source/target references, reviewed amounts, proposal hashes and missing application/audit history are rejected during isolated restore. The malformed-reference fixture disables foreign keys only in the corrupt backup so it exercises recovery rejection.
