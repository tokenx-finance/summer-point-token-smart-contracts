---
title: 'Enforce Strict Reserve Solvency'
type: 'bugfix'
created: '2026-09-01'
status: 'done'
review_loop_iteration: 0
baseline_commit: '489dace9bc40c3246eee46e4f939650cb55d490e'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Controller-held token balance is treated as a fungible reserve even when it represents isolated broker liquidity or redemption escrow. Allotment and NAV distribution skip broker quota enforcement when a broker reserve reaches zero, while the global sweep can withdraw every token held by the controller.

**Approach:** Track global funding as an explicit unallocated reserve, restrict global sweeps to that ledger, and require every broker-specific allotment and NAV distribution to consume only the wallet broker's explicit reserve. Raw token transfers remain recoverable only through a later explicitly approved reconciliation mechanism and never create spendable accounting automatically.

## Boundaries & Constraints

**Always:** Preserve floor rounding, existing roles and successful explicitly funded broker flows. Debit accounting before external token transfers. A zero broker reserve means no broker liquidity. The global sweep can access only `unallocatedReserve`; broker reserves and redemption escrow remain unavailable to it.

**Ask First:** Any automatic fallback from broker reserve to unallocated liquidity, allocation/reconciliation API, migration mechanism for tokens already held by a deployed controller, governance change, or redemption accounting redesign.

**Never:** Infer reserve ownership from the controller's live token balance, consume another broker's reserve, let unallocated funds silently satisfy broker liabilities, sweep broker reserves or redemption escrow through `sweepReserve`, or include snapshot NAV/redemption-state work in this batch.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Broker reserve exhausted | Target broker reserve is zero; controller holds other liquidity | Allotment/distribution makes no state change | Revert `InsufficientReserve(requested, 0)` |
| Broker reserve insufficient | Target broker reserve is below requested amount | No ledger or token changes | Revert with requested and broker-available amounts |
| Broker reserve sufficient | Target broker reserve covers requested amount | Debit that broker only, then transfer | Existing success events remain |
| Global reserve funded | `fundReserve(amount)` succeeds | Increase `unallocatedReserve` by amount | Revert atomically if transfer fails |
| Global sweep covered | Requested amount is within `unallocatedReserve` | Debit unallocated ledger, then transfer | Existing event remains |
| Global sweep exceeds unallocated | Controller balance includes broker reserve or escrow | No ledger or token changes | Revert using unallocated availability |
| Raw token transfer | Tokens sent directly to controller | No reserve ledger changes | Tokens are not spendable or sweepable |

</frozen-after-approval>

## Code Map

- `extensions/FundStorage.sol` -- add the explicit unallocated reserve ledger.
- `extensions/FundReserveModule.sol` -- account global funding and restrict global sweep availability.
- `extensions/FundSubscriptionModule.sol` -- remove live-balance and zero-quota fallback from allotment.
- `extensions/FundNavModule.sol` -- remove live-balance and zero-quota fallback from distribution.
- `test/QA_Full_Suite.test.ts` -- prove global sweep cannot touch broker liquidity or raw transfers.
- `test/FundControllerSubscriptionQueue.test.ts` -- prove zero and insufficient broker reserves fail closed.
- `test/DayTPlusOneRedemptionAndYield.test.ts` -- prove NAV distribution consumes only its broker reserve.

## Tasks & Acceptance

**Execution:**
- [x] Add `unallocatedReserve` state and account `fundReserve`/`sweepReserve` against it.
- [x] Require `_allot` to debit only the resolved broker reserve.
- [x] Require `_distribute` to debit only the resolved broker reserve.
- [x] Add exploit regressions for zero broker reserve, cross-broker isolation, raw transfers, and protected liabilities.
- [x] Update fixtures that intentionally need spendable reserve to use explicit funding APIs.

**Acceptance Criteria:**
- Given broker A has zero reserve while broker B and/or unallocated reserve has liquidity, broker A allotment and distribution revert with zero available.
- Given a global sweep request exceeds `unallocatedReserve`, the call reverts even when the controller's live balance is sufficient.
- Given redemption escrow exists, global sweep cannot debit it.
- Given direct token transfers to the controller, reserve ledgers remain unchanged and the tokens cannot satisfy or be withdrawn through reserve operations.
- Given valid broker funding, existing allotment and NAV distribution behavior remains successful with exact broker ledger debits.

## Review Disposition

- Focused adversarial review found no in-scope blocker.
- Per-request redemption cancellation findings remain assigned to the approved redemption-state batch.
- Fee-on-transfer accounting is not applicable to the fixed `InvestmentTokenM` dependency.
- Broker-ID validation during reserve rebalance requires an authoritative broker-existence API and was not added speculatively.

## Verification

**Commands:**
- `npx hardhat test test/FundControllerSubscriptionQueue.test.ts` -- focused allotment and broker isolation.
- `npx hardhat test test/DayTPlusOneRedemptionAndYield.test.ts test/QA_Full_Suite.test.ts` -- distribution, sweeps, and redemption escrow protection.
- `npm test` -- complete registered suite.
- `npm run lint` -- no new errors or warnings in touched files.
