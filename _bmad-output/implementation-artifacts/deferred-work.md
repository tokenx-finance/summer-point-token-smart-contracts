- source_spec: `_bmad-output/implementation-artifacts/spec-harden-investment-token-controls.md`
  summary: Correct the unauthorized-mint test to call `mint` instead of `adminTransfer`.
  evidence: `test/InvestmentTokenM.test.ts` labels the case as non-owner mint rejection but invokes `adminTransfer`, leaving unauthorized mint behavior unverified.

- source_spec: `_bmad-output/implementation-artifacts/spec-harden-investment-token-controls.md`
  summary: Correct the disabled-account transfer-limit test setup so it exercises the state named by the test.
  evidence: Both increase-transfer-limit success tests call `setTransferLimit` first, so the test labeled as disabled duplicates the enabled-account case.

- source_spec: `_bmad-output/implementation-artifacts/spec-snapshot-nav-entitlement.md`
  summary: Define and verify canonical CSV serialization and exact-content report hashing in the off-chain snapshot service.
  evidence: The controller stores an immutable report hash, but this repository contains only simulation placeholders and no authoritative CSV generation service whose byte-level hashing procedure can be tested.

- source_spec: `_bmad-output/implementation-artifacts/spec-snapshot-nav-entitlement.md`
  summary: Decide whether `setBaselineNav` must be blocked while the controller is paused.
  evidence: Adversarial review confirmed baseline initialization remains callable during pause, a pre-existing behavior not changed by the report-aware NAV implementation.
