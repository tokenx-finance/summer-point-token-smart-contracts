---
title: 'Consolidate Corridor Gateway into Allowlist Proxy V2'
type: 'refactor'
created: '2026-09-01'
status: 'done'
review_loop_iteration: 0
baseline_commit: '489dace9bc40c3246eee46e4f939650cb55d490e'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `AllowlistRegistryProxyV2` already contains the complete wallet-to-broker and corridor feature set of `BrokerCorridorGateway`, while both contracts remain presented as active implementations. This leaves two plausible sources of truth and obscures the intended production architecture.

**Approach:** Make `AllowlistRegistryProxyV2` visibly canonical by separating its wallet registry and `IBrokerCorridorGateway` implementation sections, then relocate the unchanged standalone gateway under `contracts/legacy` with an explicit deprecation notice. Preserve contract names and behavior so existing scripts and tests continue to resolve the legacy artifact.

## Boundaries & Constraints

**Always:** Preserve all public ABIs, storage layout, events, errors, access controls, corridor behavior, blacklist behavior, and V1 child-registry fallback behavior. Preserve the `BrokerCorridorGateway` contract name for backward-compatible Hardhat factory lookup. Work with the current dirty tree without altering unrelated files.

**Ask First:** Any behavioral change, migration of existing deployments or scripts to V2, deletion of the legacy contract, governance change, interface signature change, or storage reordering.

**Never:** Deploy both contracts as simultaneous authoritative registries, add adapters or dependencies, modify generated artifacts manually, clear unrelated generated output, or rewrite tests merely to accommodate the source move.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Canonical V2 use | Hook and controller are configured with Proxy V2 | Wallet registration, blacklist, child allowlists, and corridor checks use one source of truth | Existing custom errors remain unchanged |
| Legacy factory use | Existing code requests `BrokerCorridorGateway` by contract name | Hardhat discovers and deploys the contract from `contracts/legacy` | Compile or factory resolution failure blocks completion |

</frozen-after-approval>

## Code Map

- `contracts/AllowlistRegistryProxyV2.sol` -- canonical combined allowlist, wallet-broker registry, blacklist, and corridor implementation; reorganize section markers and clarify canonical responsibility without moving state or logic.
- `contracts/BrokerCorridorGateway.sol` -- current standalone implementation to relocate unchanged except for its file header and NatSpec legacy status.
- `contracts/legacy/BrokerCorridorGateway.sol` -- destination retained inside Hardhat's recursive source tree so `getContractFactory("BrokerCorridorGateway")` remains valid.
- `interfaces/IBrokerCorridorGateway.sol` -- stable runtime boundary used by `FundComplianceHook`; read-only for this change.
- `contracts/FundComplianceHook.sol` -- interface-based consumer proving no concrete import path migration is required; read-only.
- `test/AllowlistRegistryProxyV2.test.ts` -- focused canonical V2 and lifecycle coverage.
- `test/QA_Full_Suite.test.ts` and `test/InvestmentTokenHooks.test.ts` -- legacy factory and hook-integration coverage after relocation.

## Tasks & Acceptance

**Execution:**
- [x] `contracts/AllowlistRegistryProxyV2.sol` -- split existing declarations/functions into explicit wallet-registry and corridor-interface sections and update contract NatSpec to identify V2 as canonical; do not change executable logic.
- [x] `contracts/BrokerCorridorGateway.sol` → `contracts/legacy/BrokerCorridorGateway.sol` -- move the source and mark it deprecated for new deployments while preserving its contract body and name.

**Acceptance Criteria:**
- Given a clean forced compilation, when Hardhat scans `contracts`, then both Proxy V2 and the relocated legacy gateway compile without duplicate artifacts or import failures.
- Given existing code calls `getContractFactory("BrokerCorridorGateway")`, when the focused legacy tests run, then the factory resolves and existing corridor behavior passes unchanged.
- Given Proxy V2 is wired to the token hook and controller, when its integration suite runs, then allowlist, blacklist, broker lookup, and corridor behavior pass unchanged.
- Given the source tree is reviewed, when selecting a new deployment target, then Proxy V2 is clearly canonical and the standalone gateway is clearly legacy.

## Spec Change Log

- Review patch: narrowed Proxy V2 compatibility and controller-integration wording to implemented interfaces, and made the legacy gateway deprecation explicit. Executable logic, storage order, ABI, governance, and the successful source relocation were preserved.

## Design Notes

The source move intentionally keeps the legacy contract below `contracts/` because Hardhat recursively compiles nested Solidity sources. Generated artifact paths may change, but name-based factory lookup remains stable because the Solidity contract name is unchanged.

## Verification

**Commands:**
- `npx hardhat compile --force` -- expected: both source paths compile and TypeChain generation succeeds.
- `npx hardhat test test/AllowlistRegistryProxyV2.test.ts` -- expected: canonical V2 integration tests pass.
- `npx hardhat test test/InvestmentTokenHooks.test.ts test/QA_Full_Suite.test.ts` -- expected: legacy factory resolution and hook behavior pass.
- `npm run lint` -- expected: no new errors or warnings from the moved or reorganized contracts.

## Suggested Review Order

**Canonical ownership**

- Declares Proxy V2 authoritative while preserving the V1 allowlist boundary.
	[`AllowlistRegistryProxyV2.sol:13`](../../contracts/AllowlistRegistryProxyV2.sol#L13)

- Keeps wallet-to-broker resolution explicit and separate from corridor policy.
	[`AllowlistRegistryProxyV2.sol:121`](../../contracts/AllowlistRegistryProxyV2.sol#L121)

- Exposes corridor behavior through the stable gateway interface.
	[`AllowlistRegistryProxyV2.sol:181`](../../contracts/AllowlistRegistryProxyV2.sol#L181)

**Legacy compatibility**

- Marks the standalone implementation deprecated without changing its contract name or behavior.
	[`BrokerCorridorGateway.sol:9`](../../contracts/legacy/BrokerCorridorGateway.sol#L9)