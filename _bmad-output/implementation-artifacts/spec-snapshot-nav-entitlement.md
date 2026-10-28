---
title: 'Distribute NAV from Off-Chain Block Snapshot Report'
type: 'bugfix'
created: '2026-09-01'
status: 'done'
review_loop_iteration: 1
baseline_commit: '489dace9bc40c3246eee46e4f939650cb55d490e'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** NAV distribution reads live token balances, so post-cutoff transfers can change historical entitlement. The authoritative balances will instead come from an off-chain service's CSV report captured at a specific block.

**Approach:** Keep `FundNavModule` within `FundController`. SCBAM commits each NAV with the CSV snapshot block and report hash; a trusted `DISTRIBUTOR_ROLE` submits each wallet's reported balance, and the controller performs the existing floor-rounded NAV calculation and isolated broker-reserve payout on-chain.

## Boundaries & Constraints

**Always:** Grant `NAV_UPDATER_ROLE` only to the SCBAM wallet or multisig. Store immutable nonzero snapshot metadata for every cycle. Calculate yield on-chain using the submitted report balance and existing `diffPercentScaled` floor math. Preserve wallet-cycle idempotency, broker registration, strict broker reserve isolation, pause/reentrancy protection, and the single-controller atomic accounting model.

**Ask First:** Merkle proofs, signed rows, multiple reports per cycle, report correction/replacement, partial cycle cancellation, separate NAV deployment, or automatic reading of historical chain state.

**Never:** Read live balances for finalized-cycle entitlement, parse CSV on-chain, permit NAV/report metadata mutation after cycle publication, let a distributor set NAV/rates, bypass broker reserve limits, add `ERC20Snapshot` to the token, or alter redemption/public-burn policy.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Publish cycle | SCBAM supplies cycle, NAV, past/current snapshot block, nonzero report hash | Cycle and report metadata finalize atomically | Reject future block, zero hash, duplicate cycle, or invalid NAV |
| Trusted payout | Distributor supplies wallet, cycle, CSV balance | Controller computes floor-rounded shares and debits current registered broker reserve | Existing idempotency and reserve errors apply |
| Post-cutoff movement | Wallet balance changes after snapshot block | Payout remains based on submitted CSV balance | N/A |
| Zero entitlement | Report balance or NAV growth is zero | Mark wallet processed and transfer nothing | Wallet must still be broker-registered |
| Unauthorized assertion | Non-distributor submits report balance | No state change | Access-control revert |
| Audit lookup | Reader queries cycle | Snapshot block and report hash are available on-chain | N/A |

</frozen-after-approval>

## Code Map

- `extensions/FundStorage.sol` -- extend `NavCycle` with `snapshotBlock` and `reportHash`; add report validation errors and include metadata in the NAV event.
- `extensions/FundNavModule.sol` -- accept report metadata during NAV publication; accept explicit reported balances for preview and single/batch distribution; resolve broker even for zero entitlement.
- `contracts/FundController.sol` -- keep inheriting `FundNavModule`; no separate NAV deployment or cross-contract protocol.
- `test/DayTPlusOneRedemptionAndYield.test.ts` -- prove post-cutoff balance changes do not alter payout and processed-to-unprocessed transfers cannot duplicate entitlement.
- `test/QA_Full_Suite.test.ts` -- cover metadata validation, zero entitlement registration, floor math, idempotency, and strict reserve interaction.
- `test/InvestmentTokenHooks.test.ts`, `contracts/run_controller_tests.py`, and NAV scripts -- migrate calls to the report-aware NAV/distribution ABI where exercised.

## Tasks & Acceptance

**Execution:**
- [x] `extensions/FundStorage.sol` -- store immutable per-cycle CSV audit metadata and precise validation errors/events.
- [x] `extensions/FundNavModule.sol` -- replace live-balance entitlement with distributor-supplied report balances in single and batch APIs.
- [x] Focused tests -- cover every matrix row and the same-cycle transfer duplication exploit.
- [x] Harnesses/scripts -- update repository callers to the report-aware ABI without changing role ownership.

**Acceptance Criteria:**
- Given a CSV captured at block N, when balances move after N, then payouts equal the CSV balances multiplied by the committed cycle rate with protocol-safe floor rounding.
- Given a processed wallet transfers to an unprocessed wallet after N, when both report rows are distributed, then each receives only its own CSV entitlement once.
- Given invalid report metadata, when SCBAM publishes NAV, then no cycle or latest-NAV state is committed.
- Given a zero-yield or zero-balance row for an unregistered wallet, when distribution is attempted, then it fails registration rather than becoming silently processed.
- Given a finalized cycle, when queried, then its snapshot block and report hash exactly match SCBAM's submitted values.

## Spec Change Log

- Human clarification replaced token-level `ERC20Snapshot` with a trusted off-chain block snapshot CSV. The NAV module remains source-separated inside `FundController`; SCBAM commits NAV/report metadata and a role-gated distributor asserts report balances without row proofs.
- Adversarial review added nondecreasing snapshot-block enforcement, corrected event field semantics, covered successful zero rows and batch post-cutoff transfers, and repaired strict-reserve funding in executable harnesses. Existing checked floor arithmetic was retained because pinned OpenZeppelin 4.6 has no `Math.mulDiv`.

## Design Notes

This deliberately trusts `DISTRIBUTOR_ROLE` to reproduce CSV balances accurately. The report hash is an audit commitment, not on-chain row verification. Compromise of that role can misstate entitlement up to available broker reserves, so it should be an operationally controlled service account and reconciliation should compare submitted rows with the exact hashed CSV.

## Verification

**Commands:**
- `npx hardhat test test/DayTPlusOneRedemptionAndYield.test.ts test/QA_Full_Suite.test.ts test/InvestmentTokenHooks.test.ts` -- cutoff, report metadata, and integrations pass.
- `npm test` -- complete registered suite passes.
- `npm run lint` -- no new errors or warnings in touched files.
- `git diff --check` -- no whitespace errors.

## Suggested Review Order

**Report Commitment**

- SCBAM atomically commits NAV, cutoff block, and CSV audit hash.
	[`FundNavModule.sol:35`](../../extensions/FundNavModule.sol#L35)

- Cycle storage makes report metadata immutable and directly queryable.
	[`FundStorage.sol:75`](../../extensions/FundStorage.sol#L75)

**Trusted Distribution**

- Explicit CSV balances replace live token balances under distributor authorization.
	[`FundNavModule.sol:80`](../../extensions/FundNavModule.sol#L80)

- Registered broker resolution and isolated reserve debits remain fail-closed.
	[`FundNavModule.sol:111`](../../extensions/FundNavModule.sol#L111)

**Regression Evidence**

- Batch payouts remain bound to report rows after post-cutoff transfers.
	[`DayTPlusOneRedemptionAndYield.test.ts:264`](../../test/DayTPlusOneRedemptionAndYield.test.ts#L264)

- Metadata, zero-row idempotency, floor math, and batch validation are covered.
	[`QA_Full_Suite.test.ts:426`](../../test/QA_Full_Suite.test.ts#L426)
