# Response to Claude Follow-up Review

November 2, 2026. This response addresses [Claude's follow-up](reviews/CLAUDE_FOLLOWUP_2026-11-02.txt), which confirms it received the complete previous packet. The [requirements](REQUIREMENTS.md) and [architecture](ARCHITECTURE.md) now include the changes below. Implementation has not started.

## Assessment and user decisions

All five core findings identify useful gaps in operational detail. They are incorporated, with qualifications where a shortcut could produce incorrect accounting or an unjustified completeness claim. The stack and previously agreed feature scope remain unchanged.

Jacob answered the remaining questions:

| Topic | Answer | Effect on the plan |
| --- | --- | --- |
| Goal-funded purchases | Use the goal only. | Default goal-funded personal amounts to exclusion from monthly category allowance; all actual spending remains visible. Allow a per-goal override. |
| Robinhood, Strike, Venmo | Import functionality would be nice. | Include activity imports as follow-on adapters. Manual-balance/external modes cover accounts without a configured feed. Holdings/performance remain excluded. |
| Chelsea repayments | Chelsea pays via PayPal into checking. | Prioritize PayPal receipt/deposit matching with Capital One 360 rather than assuming Venmo settlements. |
| Live data protection | Use Windows protection. | No separate app launch passphrase. Use per-user storage and protected credentials; do not assume device encryption is enabled. Portable archives remain separately encrypted. |

These supplement the earlier confirmations: Capital One 360 checking, separate savings accounts, and full statement payments on all credit cards.

## Core findings

### 1. Transaction type defaults

Adopted. Ordinary validated card charges become expenses immediately, under Uncategorized when necessary. The first import does not need merchant rules to count its purchases. Supported payment codes/descriptors identify card payments; recognized rewards use an explicit reward/credit type. Other credits ask for a refund/adjustment/reward decision.

Qualifications: sign alone does not make every card debit a purchase. Explicit cash-advance, balance-transfer, and correction types override the ordinary-charge default. Asset-account movements use supported source types or saved rules and otherwise remain classification pending. A card rewards credit may be noncash: Bonus/Cashback reporting must not invent checking income. Purchase-linked adjustments are not also rewards income.

### 2. Exact overlap workflow

Adopted with explicit source metadata. Ask once per export/account for its actual range, completeness and filter date basis when these cannot be established from the source. Prefill saved download patterns; first/last transaction dates remain hints requiring confirmation.

Match occurrence counts against the latest complete compatible source snapshot for each date. Equal counts match without review; extra stable-interior occurrences are anomalies; shrinking counts warn without deleting existing activity. Supported settling windows permit late-appearing additions. Initial profile heuristics are the previous range's final day for posted-date filters and final five calendar days for transaction-date-only filters.

Qualifications: these windows are not universal bank guarantees. Full/incremental mode, date basis, conflicting identity evidence and prior exclusions matter. Do not merge snapshots by adding their counts, infer the download's empty boundary days from row extrema, or use broad merchant normalization to erase identity. Discovery timing never silently changes a purchase's budget month.

The normal-case acceptance fixture is three confirmed overlapping 90-day exports with no unchanged rows held and both identical purchases preserved. Incremental exports, changed descriptors, count reductions, and late activity outside the window get separate tests.

### 3. Accounts outside import scope

Adopted. Account financial type is separate from tracking mode. Imported accounts expect activity; manual-balance accounts use balance checkpoints and explicit estimates; external endpoints carry no running balance. A configured transfer to an owned manual/untracked destination can be complete on one imported side.

Qualifications: an external merchant payment is still spending. Tracking mode cannot determine economic type. A manually recorded balance and later imported movements must reconcile rather than double count. Requested Robinhood/Strike/Venmo activity import support is retained as follow-on work.

PayPal is the confirmed repayment route. A manually recorded received settlement and its later checking deposit link to one household event. Amount allocations handle combined/partial cash-outs; ambiguous fees or mixed deposits need a breakdown. PayPal text alone does not prove the money came from Chelsea. Expected settlements do not reduce debt before receipt.

### 4. Calculated card statements

Adopted as a reduction in manual entry, with a calculated/confirmed distinction. Set typical closing/due days and cycle relationship once, and derive cycle-close liability from a known checkpoint plus all compatible posted activity. Support per-cycle date and amount overrides. Matching payments reduce the relevant remaining obligations; partial payments do not mark the entire statement paid.

Qualifications: closing-day configuration and a CSV alone cannot establish an exact issuer statement. Starting balance, complete coverage, boundary conventions, fees/interest and source dates matter. A current card balance is not the next amount due. Credits after closing may affect the required payment differently from the current balance, so issuer-specific handling needs evidence.

With adequate inputs, calculated obligations can appear without monthly typed balances. They remain labeled estimates until source evidence or user confirmation verifies them. Statement templates can confirm or reconcile the result. The test does not promise an exact due amount from incomplete inputs.

### 5. Savings-funded allowance policy

Adopted and resolved by Jacob: Use goal only is the default, with a per-goal Count against monthly limit alternative. A $300 fully goal-funded personal gift remains $300 in spending history but uses no monthly category allowance. If only $200 is funded by a goal-only source, the remaining $100 uses the monthly allowance.

Snapshot the funding/policy on each purchase. Apply exclusions only to eligible amounts of Jacob's share, including mixed categories and multiple goals, and never claim funding beyond known availability. Refunds reverse the original spending and allowance treatment; returning money to a goal account still requires an actual cash movement. Later policy changes do not silently rewrite old budgets.

## Optional enhancements

| Suggestion | Decision |
| --- | --- |
| Narrow batch undo | Adopt. The entire mutation set, including modified links, must be untouched, dependency-free and in open periods. Otherwise offer reviewed correction or pre-import restore with a preview of all later work discarded. |
| Provisional Ask budgets | Adopt for positive verified expenses: count gross provisionally and show the amount awaiting split. Unknown refunds do not grant gross budget room. These estimates never become confirmed household shares. |
| One-click rollover correction | Adopt as the suggested confirmed action. Link the adjustment to its source remainder/prior corrections so repeated reopen/reclose and later chain recalculation cannot double-apply it. |
| Per-biller PDF templates | Adopt. Use approved declarative templates, validate identity/layout/required labels and arithmetic on every document, and retain field evidence. Changed or ambiguous layouts go to review. |

Provider errors remain recoverable. Distinguish credit exhaustion from rate limiting and other failures; do not promise a particular renewal date or silently switch providers. The already-correct provider credit discussion is retained.

## Updated verification targets

The plan now specifies first card import without rules, rewards versus payments, overlapping full ranges with twins, late-appearing postings, incremental/range discrepancies, one-sided external transfers, PayPal receipt-to-bank matching, estimated statements with and without an opening checkpoint, partial statement payments, partial goal funding and refunds, untouched-versus-edited batch undo, repeated rollover corrections, and PDF layout drift.

The monetary examples and document consistency can be checked now. Adapter behavior, forecast accuracy, and recovery guarantees still require implementation and representative files; they are acceptance targets, not completed tests.

No further product answer is required for these edits. Export schemas, actual account coverage, cycle schedules, opening balances and mappings remain onboarding/implementation inputs. The current standalone handoff is [CLAUDE_REVIEW_CURRENT.md](reviews/CLAUDE_REVIEW_CURRENT.md); earlier dated packets preserve the proposals that were previously reviewed.
