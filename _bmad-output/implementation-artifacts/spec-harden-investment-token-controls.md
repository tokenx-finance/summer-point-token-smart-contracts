---
title: 'Harden Investment Token Controls'
type: 'bugfix'
created: '2026-09-01'
status: 'done'
review_loop_iteration: 0
baseline_commit: '489dace9bc40c3246eee46e4f939650cb55d490e'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `InvestmentTokenM.adminTransfer` contradicts its NatSpec by remaining callable while paused, and allowlist registry configuration accepts addresses with no contract code. The intentional owner allowlist bypass is also not documented as a trust assumption.

**Approach:** Make admin transfers honor pause state, depend on the allowlist interface rather than its concrete implementation, reject registry addresses without deployed code, document the existing owner bypass, and lock these behaviors with focused tests.

## Boundaries & Constraints

**Always:** Preserve the existing single-owner governance model, current owner allowlist bypass, hook integration, public function signatures, and existing valid-registry behavior. Work with current uncommitted changes without reverting or rewriting them.

**Ask First:** Any change to owner privileges, hook execution, ordinary transfer behavior, public ABI, or registry interface semantics beyond validating nonzero deployed contract code.

**Never:** Introduce role-based access control, new dependencies, proxy architecture, speculative abstractions, or unrelated formatting/refactors.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Valid admin transfer | Token unpaused; owner calls `adminTransfer` | Transfer succeeds as before | Existing ERC-20 errors remain unchanged |
| Paused admin transfer | Token paused; owner calls `adminTransfer` | No balances change | Revert with `Pausable: paused` |
| Valid registry update | Owner supplies deployed `IAllowlistRegistry` contract | Registry address updates and event emits | Existing behavior remains unchanged |
| Invalid registry update | Owner supplies zero address or address without code | Registry remains unchanged | Revert with the existing zero-address error or a contract-code validation error |
| Owner transfer bypass | Owner transfers to a non-allowlisted recipient while unpaused | Transfer succeeds by documented design | No allowlist revert |

</frozen-after-approval>

## Code Map

- `contracts/InvestmentTokenM.sol` -- `onlyAllowlist` contains the intentional owner bypass; `adminTransfer` declares but did not enforce the unpaused requirement. Preserve the existing `ERC20Hooks` inheritance and hook overrides.
- `extensions/ERC20AllowListableProxy.sol` -- `_setAllowlistRegistry` validates registry input and `isAllowlist` calls the minimal registry interface.
- `interfaces/IAllowlistRegistry.sol` -- existing minimal interface implemented by both legacy and V2 registries.
- `test/InvestmentTokenM.test.ts` -- existing Admin, Transfer, registry, and Pausable suites provide focused behavior coverage.
- `test/AllowlistRegistryProxyV2.test.ts` -- integration coverage proving the V2 registry remains compatible with the token.

## Tasks & Acceptance

**Execution:**
- [x] `contracts/InvestmentTokenM.sol` -- add `whenNotPaused` to `adminTransfer` and document the intentional owner exemption in `onlyAllowlist`.
- [x] `extensions/ERC20AllowListableProxy.sol` -- use `IAllowlistRegistry` and reject registry addresses without deployed code while preserving the current zero-address behavior.
- [x] `test/InvestmentTokenM.test.ts` -- add focused regression tests for paused admin transfer and EOA registry rejection; preserve existing owner-bypass coverage.

**Acceptance Criteria:**
- Given a paused token, when the owner calls `adminTransfer`, then the call reverts and balances remain unchanged.
- Given an unpaused token, when the owner calls `adminTransfer`, then existing transfer behavior remains unchanged.
- Given an EOA as a proposed registry, when the owner calls `setAllowlistRegistry`, then the call reverts and the configured registry remains unchanged.
- Given a deployed compatible registry, when the owner configures it, then configuration and allowlist reads continue to work.
- Given a non-allowlisted recipient and an unpaused token, when the owner transfers tokens, then the documented owner bypass continues to succeed.

## Spec Change Log

## Verification

**Commands:**
- `npx hardhat test test/InvestmentTokenM.test.ts` -- expected: token unit tests pass.
- `npx hardhat test test/AllowlistRegistryProxyV2.test.ts` -- expected: V2 integration tests pass.
- `npm run lint` -- expected: no errors or new warnings in changed files.

## Suggested Review Order

**Transfer controls**

- Documents the trusted-owner bypass at the policy entry point.
	[`InvestmentTokenM.sol:44`](../../contracts/InvestmentTokenM.sol#L44)

- Makes privileged transfers honor the token pause state.
	[`InvestmentTokenM.sol:332`](../../contracts/InvestmentTokenM.sol#L332)

**Registry boundary**

- Uses the minimal registry interface instead of a concrete implementation.
	[`ERC20AllowListableProxy.sol:5`](../../extensions/ERC20AllowListableProxy.sol#L5)

- Rejects zero and code-less registry addresses before storing configuration.
	[`ERC20AllowListableProxy.sol:41`](../../extensions/ERC20AllowListableProxy.sol#L41)

**Verification**

- Covers constructor rejection for a code-less registry.
	[`InvestmentTokenM.test.ts:32`](../../test/InvestmentTokenM.test.ts#L32)

- Covers paused privileged transfer and unchanged balances.
	[`InvestmentTokenM.test.ts:95`](../../test/InvestmentTokenM.test.ts#L95)

- Proves replacement registry delegation after configuration.
	[`InvestmentTokenM.test.ts:645`](../../test/InvestmentTokenM.test.ts#L645)
