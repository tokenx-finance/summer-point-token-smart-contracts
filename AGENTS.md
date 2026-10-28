# Agent Instructions

<!-- bmad:context -->
<!-- Verified 2026-08-14 against 489dace9bc40c3246eee46e4f939650cb55d490e. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## summer-point-token-smart-contracts

Tokenized mutual fund (tMMF) smart contracts for SCBAM on Hyperledger Besu. Built with Solidity 0.8.24, Hardhat, and OpenZeppelin Contracts. Main handoff context lives in `HANDOFF.md`.

## Policy

- Preserve protocol-safe floor rounding math for NAV distributions — do not change to round-half-up.
- Ensure wallets are registered in `AllowlistRegistryProxyV2` before triggering allotment or distribution.
- Do not bypass corridor checks on token transfers without explicit architectural approval.
- **Custodial Wallet Architecture**: On Hyperledger Besu, investor accounts are custodial wallets managed by the Selling Agent (InnovestX KMS). When a user redeems, the custodial signer calls `requestRedemption(amount, refId)` directly on behalf of the user (`msg.sender = investorWallet`).
- **Non-Custodial Compatibility**: On public blockchains or with self-custody wallets, investors directly call `approve(...)` and `requestRedemption(amount, refId)` themselves.
- **Consortium RBAC Roles**: TokenX holds `DEFAULT_ADMIN_ROLE`, SCBAM holds `AM_ROLE`, and InnovestX holds `SELLING_AGENT_ROLE`.

## Where things are

- Core NAV push distribution controller: `contracts/FundController.sol`
- Multi-broker corridor gateway: `contracts/AllowlistRegistryProxyV2.sol`
- Main investment token contract: `contracts/InvestmentTokenM.sol`
- Transfer compliance lifecycle hook: `contracts/FundComplianceHook.sol`
- Handoff & context documentation: `HANDOFF.md`
- Implementation specs: `_bmad-output/implementation-artifacts/`

## Running and verifying

- Python EVM test harness: `python run_controller_tests.py` and `python run_corridor_tests.py`
- Standard Hardhat verification: `npm test` (`hardhat test`) and `npm run lint`

## Conventions that differ from defaults

- On-chain NAV growth percentage calculation: `diffPercentScaled = (newNav - oldNav) * 1e10 / oldNav`.
- NAV oracle updates are strictly non-decreasing (`NavCannotDecreaseViaOracle`).

## Known pitfalls

- Corridor permissions are pairwise and non-transitive (A↔B + B↔C does not open A↔C).
- Do not assume test assertion failures mean contract bugs — check test arithmetic for pre-existing state modifications first.

<!-- /bmad:context -->
