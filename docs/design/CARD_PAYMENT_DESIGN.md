# Card payments, credits and carried balances

Schema 26 adds reviewed obligations and exact-cent allocations from actual card-payment transactions or identified card credits. It supplies the checking timeline implemented in schema 27. All QA uses synthetic workspaces.

## Carry and new obligations

An issued statement may include debt already tracked in an earlier cycle. Review the oldest saved cycle first. For each later cutoff, compute the unpaid portion of each earlier incremental obligation at that cutoff, considering allocations whose card-side posting dates are on or before it. The user confirms that the new statement includes this carried amount. The new obligation is the positive statement balance minus those carried portions. For example, balances of 100, 150 and 200 with no payments create incremental obligations of 100, 50 and 50, not 450 of planned cash outflow.

Earlier debt retains its original due date. Carried debt appears for reconciliation in later statements but is allocated only to its original incremental obligation. Show both the remaining new amount and remaining carried debt; covering a later cycle's new amount alone does not mean its entire cumulative statement balance is covered.

Late allocations before a later cutoff change the proposed carry and mark that cycle for review. Allocations after its cutoff reduce the original obligation without rewriting the amount carried at closing. Changed or missing earlier reviews propagate uncertainty. If earlier unpaid debt exceeds the later statement balance, reconcile payments/credit treatment before approving carry. Calculated balances can be used after issuer dates and the statement calculation have been reviewed; incomplete inputs remain qualified. Changed calculations require a fresh statement review, followed by obligation review.

## Actual payments and credit decisions

One actual payment can be split across several reviewed obligations, but all allocations together cannot exceed its exact cents. A statement cannot receive more than its remaining incremental obligation. The card-side posting date must be strictly after its cutoff; a payment already included in the issued balance cannot reduce it again. Bank and card posting dates remain separate. Assumed dates are disclosed and require explicit review.

Refunds and reward credits never automatically fulfill payment requirements. An explicit review can allocate the issuer-accepted amount, partially allocate it, or record no reduction. Unassigned credit remains unapplied to payment requirements. An unreviewed post-close credit qualifies projections. Neither allocation nor credit review creates account activity, spending, income or a household repayment.

## Corrections and persistence

Source transactions keep a reviewed financial/date snapshot. The common transaction boundary rejects money, endpoint or effective posting-date changes while a review exists, including late import links and import undo. Nonfinancial descriptions and notes remain editable. Clear the saved review explicitly before financial changes; clearing preserves the actual transaction.

Changing a statement's issuer amount or dates requires clearing its obligation review, its own allocations and later carry dependencies first. Notes/evidence remain editable. Recalculations preserve existing allocations but require review; a reduced amount cannot be approved below allocated totals. Revisions, live view tokens and payload-bound receipts protect retries and concurrent changes. Receipt failures roll back every allocation. Restore validation checks amounts, snapshots, references and receipts, including extreme corrupt integers without panicking.

Closed monthly spending and shared reports remain unchanged by later allocations. The implemented checking forecast consumes remaining incremental obligations once, keeps cumulative display totals separate, and carries review/credit/coverage warnings forward.
