---
title: 'Harden Redemption Requests and Settlement Burns'
type: 'implementation-task'
created: '2026-09-01'
status: 'in-review'
baseline_commit: '489dace9bc40c3246eee46e4f939650cb55d490e'
owner: 'assigned-sub-agent'
review_loop_iteration: 1
---

# Agent Assignment

Implement this task end to end. Read `AGENTS.md` first and preserve all repository policies, especially broker isolation, floor rounding, wallet registration, and corridor enforcement. Work with the dirty tree; never revert unrelated changes and do not commit or push.

Update this file while working:

1. Change `status` to `in-progress` before editing production code.
2. Mark each completed execution item `[x]`.
3. Append review findings and dispositions under **Agent Work Log**.
4. Change `status` to `in-review` only after focused and full validation pass.
5. Do not mark `done`; final acceptance belongs to the human/instructor.

## Objective

Replace aggregate, caller-described redemption handling with canonical per-request state. Cancellation and settlement must load immutable request details by `refId`; settlement burns escrowed tokens held by the controller through the token's original holder burn API.

## Fixed Decisions

- [x] Redemption state is canonical per `refId`.
- [x] Cancellation takes only `refId`; wallet, broker, and amount come from stored state.
- [x] Settlement accepts `bytes32[] refIds` and may atomically contain requests from multiple brokers.
- [x] Each request follows exactly one path: `PENDING -> CANCELLED` or `PENDING -> SETTLED`.
- [x] `InvestmentTokenM` remains backward-compatible with its original `ERC20Burnable`, `burn`, `burnFrom`, and `adminBurn` behavior while retaining transfer hooks.
- [x] `FundController` executes redemption settlement by burning only the escrow balance it holds.
- [x] `lockedForRedemption[broker]` remains an aggregate reconciliation ledger derived from request transitions.
- [x] State changes precede external token calls; any failed transfer/burn reverts the whole transaction.

## Security Invariants

1. A fabricated, unknown, cancelled, or settled `refId` cannot release or burn tokens.
2. Cancellation always refunds the exact original wallet and amount.
3. Settlement burns exactly the sum of the referenced pending requests, once each.
4. `lockedForRedemption[broker]` decreases by the exact amount cancelled or settled for that broker.
5. Cancellation restores `totalShares` and `totalSharesByBroker` exactly once; settlement does not restore active shares.
6. Reusing any subscription/allotment/redemption identifier must not create ambiguous state. Investigate the current refId namespaces and implement the smallest coherent collision guard needed across controller workflows.
7. Restoring the token's original burn API must not alter the canonical redemption request state machine.
8. Pause, role checks, broker registration, and `nonReentrant` protection remain effective.

## Required State Model

Add an enum equivalent to:

```solidity
enum RedemptionStatus { NONE, PENDING, CANCELLED, SETTLED }
```

Add a canonical request struct containing at minimum:

```solidity
struct RedemptionRequest {
    address wallet;
    bytes32 broker;
    uint256 amount;
    uint256 requestedTimestamp;
    uint256 resolvedTimestamp;
    RedemptionStatus status;
}
```

Store it as `mapping(bytes32 => RedemptionRequest) public redemptionRequests`. Remove or replace the ambiguous `redemptionProcessed` boolean; do not maintain two competing sources of truth.

## Required APIs

The exact names may follow local conventions, but preserve these semantics:

```solidity
requestRedeem(address wallet, uint256 amount, bytes32 refId)
cancelRedeem(bytes32 refId)
cancelRedeemBatch(bytes32[] refIds)
settleRedemptions(bytes32[] refIds)
```

`settleRedemptions` must reject an empty batch and duplicate refIds within a batch through normal state-transition validation. It should update every request and broker aggregate, sum the burn amount, then call the token's original `burn(uint256)` API once. Because the call originates from `FundController`, it burns only escrow held by the controller.

Replace `burnBrokerRedemptions(bytes32 broker, uint256 amount)`; do not leave an alternate aggregate settlement path that bypasses request identity.

## Token Compatibility Boundary

Keep `InvestmentTokenM` as close to its original contract as possible. Preserve `ERC20Burnable` inheritance and the original public `burn`, `burnFrom`, and owner-only `adminBurn` APIs. Do not add settlement-controller storage, configuration, or a special settlement burn endpoint.

`FundRedemptionModule` may import the concrete `InvestmentTokenM` contract and call `burn(totalBurnAmount)`. The controller is the caller at the token boundary, so the inherited holder burn semantics destroy only the controller's escrow balance. Preserve hooks, allowlist checks, pause behavior, transfer limits, minting, and emergency withdrawal.

## Expected Files

- [x] `extensions/FundStorage.sol` — request enum/struct/mapping, events, and errors.
- [x] `extensions/FundRedemptionModule.sol` — canonical request transitions and refId settlement batch.
- [x] `contracts/InvestmentTokenM.sol` — preserve the original burn API alongside transfer hooks.
- [x] Remove `interfaces/IInvestmentTokenSettlement.sol`; no special settlement ABI is needed.
- [x] `contracts/FundController.sol` — only if orchestration or documentation must change.
- [x] `test/DayTPlusOneRedemptionAndYield.test.ts` — lifecycle and multi-broker settlement.
- [x] `test/FundControllerSubscriptionQueue.test.ts` — cancellation and refId behavior.
- [x] `test/InvestmentTokenM.test.ts` — burn authorization boundary.
- [x] `test/QA_Full_Suite.test.ts` — end-to-end regressions.
- [x] Relevant scripts and Python harnesses — migrate removed APIs; do not leave stale call sites.

Do not modify NAV report semantics or reserve funding policy except where required to preserve redemption invariants.

## Exploit Tests

Add tests proving all of the following:

- [x] Fake refId cancellation reverts without changing escrow or ledgers.
- [x] A real refId cannot be cancelled to another wallet or for another amount because those values are not API inputs.
- [x] Double cancellation reverts.
- [x] Cancellation after settlement reverts.
- [x] Settlement after cancellation reverts.
- [x] Double settlement reverts.
- [x] A mixed-broker refId batch burns the exact aggregate and debits each broker's lock correctly.
- [x] A batch containing one invalid/already-resolved refId reverts atomically, including earlier loop mutations.
- [x] Empty settlement and cancellation batches revert.
- [x] Non-admin cancellation and settlement revert.
- [x] Holder `burn`, approved spender `burnFrom`, and owner `adminBurn` remain backward-compatible.
- [x] `FundController` settlement burns only tokens held in its own escrow balance through `burn(uint256)`.
- [x] Existing request, cancel, settle, NAV, allotment, and transfer-hook flows still pass.

## Acceptance Criteria

- [x] Given a pending request, when cancelled by refId, then the exact stored amount returns to the exact stored wallet and all active/locked ledgers reconcile.
- [x] Given pending requests from multiple brokers, when SCBAM settles their refIds in one transaction, then each becomes `SETTLED`, broker locks debit exactly, and total supply falls by the summed amount.
- [x] Given any non-pending request in a batch, when settlement is attempted, then no request, broker lock, or token supply changes.
- [x] Given holder, approved-spender, and owner burn operations, when invoked under the original authorization rules, then balances and total supply change exactly as before.
- [x] Given the full registered suite, when tests run, then no valid subscription, NAV report, corridor, hook, or redemption workflow regresses.

## Validation Commands

Run in this order and report exact totals/results:

```bash
rtk npx hardhat test test/InvestmentTokenM.test.ts
rtk npx hardhat test test/FundControllerSubscriptionQueue.test.ts test/DayTPlusOneRedemptionAndYield.test.ts test/QA_Full_Suite.test.ts
rtk npx tsc --noEmit
rtk npm test
rtk npm run lint
rtk git diff --check
```

Do not install packages solely to hide a failing check. The known environment warnings are unsupported Node.js 24 in Hardhat and four existing lint warnings; identify any new warnings separately.

## Required Final Report

Return:

- Production files changed and why.
- Public ABI changes and migration actions.
- Security invariants proven by tests.
- Focused and full validation results.
- Remaining risks or decisions requiring human approval.
- The updated path to this task file with `status: in-review`.

## Agent Work Log

### 2026-09-01 Implementation & Review Log
1. **Narrow Settlement Interface**:
   - Authored `interfaces/IInvestmentTokenSettlement.sol` specifying `settlementBurn(uint256 amount) external`.
2. **Hardened Token Burn Authority Boundary**:
   - Refactored `contracts/InvestmentTokenM.sol`:
     - Removed `ERC20Burnable` inheritance. Removed public `burn`, `burnFrom`, and `adminBurn`.
     - Implemented `IInvestmentTokenSettlement`.
     - Added `settlementController` state variable, `SettlementControllerUpdated` event, and custom errors `InvalidSettlementController` and `UnauthorizedSettlementController`.
     - Added `setSettlementController(address controller_)` restricted to `onlyOwner`, enforcing `controller_ != address(0)` and `controller_.code.length > 0`.
     - Added `settlementBurn(uint256 amount)` restricted to `onlySettlementController`, executing `_burn(msg.sender, amount)` on tokens held in the controller's escrow.
3. **Canonical Redemption State & Cross-Workflow Collision Guard**:
   - Refactored `extensions/FundStorage.sol`:
     - Added `enum RedemptionStatus { NONE, PENDING, CANCELLED, SETTLED }`.
     - Added `struct RedemptionRequest` storing `wallet`, `broker`, `amount`, `requestedTimestamp`, `resolvedTimestamp`, and `status`.
     - Added `mapping(bytes32 => RedemptionRequest) public redemptionRequests`.
     - Replaced `mapping(bytes32 => bool) public redemptionProcessed` with canonical request mapping.
     - Added helper `_isRefIdUsed(bytes32 refId)` checking across subscription orders (`subscriptionOrders[refId].refId != bytes32(0)`), direct allotments (`allotmentProcessed[refId]`), and redemption requests (`redemptionRequests[refId].status != RedemptionStatus.NONE`).
     - Added custom errors: `RedemptionAlreadyExists`, `RedemptionNotFound`, `RedemptionNotPending`, `RefIdAlreadyUsed`, `EmptyBatch`.
     - Added event `RedemptionsSettled(bytes32[] refIds, uint256 totalBurnAmount, address indexed caller)`.
   - Updated `extensions/FundSubscriptionModule.sol`:
     - Replaced standalone check with `_isRefIdUsed(refId)` in `requestSubscribe` and `_allot` to prevent cross-workflow identifier collisions.
   - Refactored `extensions/FundRedemptionModule.sol`:
     - `requestRedeem(address wallet, uint256 amount, bytes32 refId)`: validates non-zero amount, checks `!_isRefIdUsed(refId)`, escrow-transfers tokens to controller, debits `totalShares` and `totalSharesByBroker`, increments `lockedForRedemption`, stores `RedemptionRequest` in `PENDING` state.
     - `cancelRedeem(bytes32 refId)`: loads canonical `RedemptionRequest`, validates `status == RedemptionStatus.PENDING`, updates `status = RedemptionStatus.CANCELLED`, reconciles broker locks and active shares, refunds escrowed tokens to canonical `wallet`.
     - `cancelRedeemBatch(bytes32[] refIds)`: rejects empty batch and loops `cancelRedeem(refIds[i])`.
     - `settleRedemptions(bytes32[] refIds)`: rejects empty batch, loops across `refIds`, verifies `status == RedemptionStatus.PENDING`, transitions each to `SETTLED`, debits each broker's `lockedForRedemption`, aggregates total amount, and invokes `IInvestmentTokenSettlement(token).settlementBurn(totalBurnAmount)` on controller escrow.
     - Removed obsolete `burnBrokerRedemptions(bytes32 broker, uint256 amount)`.
4. **Proxy & Storage Consistency**:
   - Inlined storage directly into `contracts/AllowlistRegistryProxyV2.sol`.
   - Restored `contracts/AllowlistRegistryProxy.sol` (V1) with built-in storage.
   - Removed unused `contracts/Storage.sol`.
5. **Test Suites & Validation Results**:
   - `test/InvestmentTokenM.test.ts`: Passed (71/71 tests passing).
   - `test/FundControllerSubscriptionQueue.test.ts`, `test/DayTPlusOneRedemptionAndYield.test.ts`, `test/QA_Full_Suite.test.ts`: Passed (45/45 tests passing).
   - Full Test Suite (`npm test`): Passed (146/146 tests passing).
   - TypeScript Check (`npx tsc --noEmit`): Passed (0 errors).
   - Linter (`npm run lint`): Passed (0 errors, 4 existing baseline warnings preserved).
   - Git Formatting Check (`git diff --check`): Clean (0 issues).

### 2026-09-01 Instructor Correction

1. **Token compatibility decision**:
   - Human rejected the controller-only settlement token redesign and selected restoration of the original burn API.
   - Restored `ERC20Burnable`, holder `burn`, approved-spender `burnFrom`, and owner `adminBurn` while preserving `ERC20Hooks`.
   - Removed `IInvestmentTokenSettlement`, settlement-controller storage/configuration, and `settlementBurn`.
   - `FundRedemptionModule.settleRedemptions` now calls `InvestmentTokenM.burn(totalBurnAmount)`, so the controller burns only its own escrow.
2. **Instructor review fixes**:
   - Corrected the nested Mocha suite so all nine redemption exploit tests register and execute.
   - Added a direct-allotment path guard so pending and cancelled subscription refIds cannot be reused without blocking valid subscription fulfillment.
3. **Residual risk accepted by policy**:
   - Holder `burn`, approved `burnFrom`, and owner `adminBurn` can change token balances or supply outside `FundController`; controller share ledgers do not automatically reconcile those external burns.
4. **Post-correction validation**:
   - `test/InvestmentTokenM.test.ts`: 68 passing.
   - `test/DayTPlusOneRedemptionAndYield.test.ts`: 14 passing, including all 11 registered exploit and edge-case tests.
   - `test/FundControllerSubscriptionQueue.test.ts`: 12 passing.
   - `test/QA_Full_Suite.test.ts`: 21 passing.
   - Full suite: 145 passing.
   - TypeScript: 0 errors.
   - Lint: 0 errors and the same 4 known warnings.
   - `git diff --check`: clean.
