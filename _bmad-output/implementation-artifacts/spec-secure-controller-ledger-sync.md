---
title: 'Secure Controller Broker Ledger Synchronization'
type: 'bugfix'
created: '2026-09-01'
status: 'done'
review_loop_iteration: 0
baseline_commit: '489dace9bc40c3246eee46e4f939650cb55d490e'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `FundController.syncBrokerShares` permits arbitrary callers while no compliance hook is configured and credits the destination broker even when the source ledger cannot cover the transfer. Controller configuration can restore or redirect that authority by accepting zero addresses and EOAs.

**Approach:** Fail closed unless a deployed compliance hook is configured and calling, require the source broker ledger to cover every movement, and reject zero or code-less broker registry and compliance hook addresses. Lock each boundary with exploit-focused tests while preserving valid Proxy V2 and legacy gateway integrations.

## Boundaries & Constraints

**Always:** Preserve the existing roles, public function signatures, events, successful cross-broker synchronization, total-share accounting, Proxy V2 compatibility, and legacy gateway compatibility. Validate only nonzero deployed code; do not claim ERC-165 interface support that these contracts do not expose. Work with the dirty tree without altering unrelated changes.

**Ask First:** Any governance change, two-step configuration protocol, interface or ABI change beyond new custom errors, broker-scoped roles, hook behavior change, or accounting redesign outside broker-ledger synchronization.

**Never:** Permit synchronization while the hook is unset, floor an insufficient source ledger to zero, authorize EOAs, migrate call sites, modify reserve/NAV/redemption logic, or weaken corridor enforcement.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unconfigured synchronization | Controller has no compliance hook; arbitrary caller requests movement | No ledger changes | Revert `OnlyComplianceHook` |
| Unauthorized synchronization | Hook configured; another caller requests movement | No ledger changes | Revert `OnlyComplianceHook` |
| Insufficient source shares | Authorized hook requests more than source broker ledger | No ledger changes | Revert with requested and available amounts |
| Valid synchronization | Authorized hook moves an amount covered by source broker | Source decreases and destination increases by the same amount | Emit existing `BrokerSharesSynced` event |
| Unsafe configuration | Admin supplies zero or EOA as registry/hook | Existing configuration remains unchanged | Revert with a configuration-specific custom error |
| Valid configuration | Admin supplies deployed Proxy V2, legacy gateway, or hook | Configuration updates | Existing integrations continue working |

</frozen-after-approval>

## Code Map

- `extensions/FundReserveModule.sol` -- `syncBrokerShares` owns the fail-open caller check and source-ledger flooring defect.
- `extensions/FundStorage.sol` -- shared custom-error declarations for controller configuration and broker-ledger insufficiency.
- `contracts/FundController.sol` -- `setBrokerRegistry` and `setComplianceHook` currently store unchecked addresses.
- `test/InvestmentTokenHooks.test.ts` -- hook/controller fixture currently omits `setComplianceHook`; add configuration and exploit regressions here.
- `test/AllowlistRegistryProxyV2.test.ts` -- proves valid Proxy V2 hook/controller synchronization remains compatible.
- `test/QA_Full_Suite.test.ts` -- proves valid legacy gateway behavior remains compatible.

## Tasks & Acceptance

**Execution:**
- [x] `extensions/FundStorage.sol` -- add precise custom errors for invalid registry, invalid hook, and insufficient broker shares.
- [x] `extensions/FundReserveModule.sol` -- require a configured exact hook caller and revert rather than over-credit when source shares are insufficient.
- [x] `contracts/FundController.sol` -- reject zero and code-less registry/hook configuration before mutating state.
- [x] `test/InvestmentTokenHooks.test.ts` -- configure the controller-hook handshake and add exploit-focused tests for every matrix row.

**Acceptance Criteria:**
- Given an unconfigured or cleared controller, when any address calls broker synchronization, then the call reverts and both broker ledgers remain unchanged.
- Given valid Proxy V2 or legacy gateway wiring, when a covered cross-broker token transfer completes, then broker ledgers move exactly once and `totalShares` remains unchanged.
- Given an invalid setter input, when the admin attempts configuration, then the prior configured address remains unchanged.
- Given all focused and full tests, when verification runs, then no existing valid workflow regresses.

## Spec Change Log

- Review patch: added fail-closed tests proving unauthorized zero-amount and same-broker synchronization calls still revert before no-op handling. Production logic and the successful integration behavior were preserved.

## Verification

**Commands:**
- `npx hardhat test test/InvestmentTokenHooks.test.ts` -- expected: new exploit regressions and valid hook flows pass.
- `npx hardhat test test/AllowlistRegistryProxyV2.test.ts test/QA_Full_Suite.test.ts` -- expected: canonical and legacy gateway integrations pass.
- `npm test` -- expected: complete registered suite passes.
- `npm run lint` -- expected: no new errors or warnings in touched files.

## Suggested Review Order

**Synchronization boundary**

- Fails closed unless the exact configured hook calls with covered source shares.
	[`FundReserveModule.sol:92`](../../extensions/FundReserveModule.sol#L92)

- Defines precise errors without changing existing controller interfaces.
	[`FundStorage.sol:177`](../../extensions/FundStorage.sol#L177)

**Configuration boundary**

- Rejects zero and code-less registry or hook addresses before state mutation.
	[`FundController.sol:43`](../../contracts/FundController.sol#L43)

**Regression evidence**

- Covers unconfigured, unauthorized, no-op, and insufficient-ledger exploit paths.
	[`InvestmentTokenHooks.test.ts:100`](../../test/InvestmentTokenHooks.test.ts#L100)

- Wires the legacy integration through the now-required controller handshake.
	[`QA_Full_Suite.test.ts:103`](../../test/QA_Full_Suite.test.ts#L103)