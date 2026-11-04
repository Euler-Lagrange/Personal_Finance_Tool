# Pay policy and weekly hours — November 4, 2026

Scope: first section of the authorized pay/hours extension. Effective-dated straight-time rates, daily planned/actual work, whole-hour sick requests, unpaid absence, manual official holidays and explicit annual sick setup. Schema 38; release 0.3.0. Document/calendar intake, paycheck/net forecasting, tax rules, financial linking and managed destination backups follow separately. No personal financial data was read or imported for testing.

## Correctness and recovery

- Rates and hours retain four decimal places as integers. Weekly gross rounds half up once after adding exact daily products. Missing rates and unresolved sick allocations do not produce a misleading gross total.
- 32 work + 8 sick and 39 work + 1 sick produce $3,720 at $93/hour. 45 work without sick produces $4,185. Holiday work is allowed. Sick on official holidays, weekly paid totals over 40, unconfirmed annual setup and exhausted annual allowance are review issues. Actual work is retained when these conflicts arise. Fractional sick hours and days exceeding 24 hours reject atomically.
- The January 1 allowance reset does not split one Monday–Sunday weekly cap into two caps. Planned sick reservations are distinct from recorded use; only not-yet-recorded days reserve planned sick hours.
- Schema 38 stores a versioned current state and replayable change history with payload/result hashes. Stable request IDs prevent duplicate saves after lost responses; changed payloads and stale revisions reject. Normal reads validate structure; recovery additionally replays complete history. Corrupted history/state rejects restore without changing the working records.
- A synthetic schema-37 workspace upgrades with an existing shared expense intact. Payroll survives local restore and encrypted handoff to a separate root, retains the $70 personal share, and does not appear in Sample. Recording hours creates no income or expense.

## UI review and corrections

- Weekly actuals remain blank until recorded, while copying the usual week only fills plans. Paste requires dates in the selected week and whole sick hours; review/save remains explicit. Rejected saves keep drafts; successful saves followed by failed reads still report that the write succeeded. Delayed reads cannot replace a more recently selected week.
- A focused paste test initially timed out after a validation error because a nested textarea made its label match depend on the current text. An explicit `for`/`id` association fixes that ambiguity; the same invalid-then-corrected paste test now passes.
- Browser captures inspected at 1100×820 in Light and Dracula show separate cards, contained table scrolling and readable modal fields. Context help remains available in the page/editor. Browser evidence is mocked IPC, not native Windows clipboard/drop proof.

## Checks

- Full core suite: **348 passed, 0 failed, 3 ignored**. The ignored cases require an OCR language, credential-store environment or live provider setup.
- A final additional annual-exhaustion/calendar-correction case plus the five earlier payroll cases: **6 focused passes**. Combined distinct core coverage: **349 passed**; this is not a full 349-test rerun.
- Full mocked browser suite: **201 passed**. Focused payroll suite: **5 passed**, included in that total.
- TypeScript, Prettier, Cargo formatting, Clippy with warnings denied and release-version parity: passed.
- Windows production app/NSIS build: exit 0; release 0.3.0. Copies were made only after bundle completion, checked for locks/reparse paths, and verified against source SHA-256. No user process was stopped. Normal Vite large-chunk advice remains nonblocking.

| Delivered artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| [Application](../../builds/Personal%20Finance.exe) | 26,668,544 | `E8F10952E563507AE8357DE99E6E5F1FE607351915071624FA0A920D281EE212` |
| [Installer](../../builds/Personal%20Finance%20Setup.exe) | 226,537,555 | `FB25A6B6C8C3BD0440BC00F28A706B00872E8785518B9FCC8CD653AA0FA17C56` |

## Limits and next section

No employer paystubs, actual issuer exports, real OneDrive folder, clean-PC install or physical laptop transfer were used. Native input limitations from [the reliability pass](QA_2026-11-04_reliability.md) remain explicit; no repeat native paste/drop claim is made here. Next: reviewed calendar/document intake with synthetic sources, explicit week assignments and source-conflict review.
