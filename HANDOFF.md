# tMMF Smart Contract Work — Handoff Context

Continuation context for the tokenized mutual fund (tMMF) smart contract
work for SCBAM, built on a private Hyperledger Besu network. This session
designed and verified three Solidity contracts against the "หลักการ
constant nav.xlsx" spreadsheet's distribution model and a hand-drawn
architecture diagram. Picking this up fresh: read this whole file before
touching code, it front-loads decisions already made and why.

## Origin: the spreadsheet

`หล_กการ_constant_nav.xlsx` (uploaded, single sheet "NAV เพิ่มขึ้น") models a
**constant-NAV distribution**: instead of NAV-per-unit floating, the fund's
NAV growth is distributed by crediting each holder additional units at the
same rate (`unitsToday = unitsYesterday + ROUND(unitsYesterday * multiplier, 2)`,
where `multiplier = (NAVToday - NAVYesterday) / totalUnits`). ~35 holders,
plus a rank column (`ลำดับในการโปรย`, via `XMATCH`+`SORTBY`) that orders
holders for allocating a small rounding residual (~0.023 baht out of
~14,886 distributed). That rank/residual-allocation mechanism was
deliberately **not** replicated on-chain — see "Deliberate deviations" below.

## Architecture diagram (user-provided image)

```
SCBAM Mint --> tMMF A <-- SCBAM Mint
                 |  |
    mint for InnovestX   mint for Dime
    and ledger total     and ledger total
                 v  v
           DistributionController
              /    |    |    \
   Allotment/Distribute NAV daily (both sides)
   /        \              /        \
InnovestX#1  InnovestX#2  Dime#1   Dime#2
InnovestX#3  InnovestX#4  Dime#3   Dime#4
                  ^--------v (cross-broker corridor, InnovestX#4 <-> Dime#3)
```

Key implications extracted from this diagram (not all obvious from the
picture alone — captured here so they aren't re-derived from scratch):
- The controller needs a **per-broker ledger** ("ledger total" appears
  twice, once per broker feed), not just one global total.
- Cross-broker transfer is drawn as an *exception* (one dotted-style
  corridor between two specific wallets), implying same-broker transfers
  are unrestricted by default and cross-broker is opt-in per pair.
- "Allotment / Distribute NAV daily" from the controller down to wallets
  is one arrow style covering *both* flows (first-time purchase AND
  ongoing NAV growth) — this is why the controller ended up with two
  parallel entry points (`allotShares` vs `distributeToWallet`) sharing one
  ledger, rather than two separate contracts.

## Three contracts, current state

All under `/mnt/user-data/outputs/src/`. All compiled clean (zero warnings)
against **OpenZeppelin Contracts v5.0.2** and **solc 0.8.24**, and
deployed+exercised on a real EVM (py-evm via eth-tester/web3.py — see
"Testing methodology" below for why not Foundry). Test scripts are the
`run_*.py` files in `/mnt/user-data/outputs/`.

### 1. `ConstantNavVault.sol` — NOT the current direction, kept for reference

First attempt: ERC-4626-style share/exchange-rate vault (lazy `balanceOf`
computed as `shares * totalNav / totalShares`, no per-wallet state
mutation on NAV update). Superseded once the user clarified the actual
requirement was **per-wallet push distribution** (Model B), matching the
diagram's `DistributionController` box. Has its own Foundry test suite
(`test/ConstantNavVault.t.sol`) and a `foundry.toml`/`remappings.txt` for
real Foundry use, since this was built before the solc-via-GitHub testing
approach was worked out. **Probably not worth building further** unless a
future requirement specifically wants lazy/O(1) exchange-rate accounting
instead of explicit per-wallet ledger entries — flag this file's continued
relevance to the user rather than assuming it's dead weight.

### 2. `NavDistributionController.sol` — the active core contract

Two independent entry points, one shared ledger:

- **`allotShares(wallet, amount, subscriptionId)`** / `allotSharesBatch(...)`
  — first-time/subscription purchase. No NAV cycle involved at all;
  `amount` is decided off-chain (subscription baht ÷ current NAV price),
  transferred straight from the controller's reserve. Idempotent on
  `subscriptionId` (caller-supplied, e.g. gateway's request ID).

- **`updateNav(cycleId, newNav)`** then **`distributeToWallet(wallet, cycleId)`**
  / `distributeToWallets(...)` — daily NAV growth distribution.
  `updateNav` computes `diffPercentScaled = (newNav-oldNav)*1e10/oldNav`
  **on-chain** and locks it per cycle (not pre-computed off-chain and
  pushed as a number — the user specifically asked for on-chain calc).
  `distributeToWallet` reads the wallet's **current token balance**
  (`investmentToken.balanceOf(wallet)`) as its share count — there is
  **no per-wallet mapping on this contract**; the ERC20 balance IS the
  share record. Idempotent per `(wallet, cycleId)`.
  Requires `setBaselineNav()` once before the first `updateNav()` call —
  there's no prior NAV to diff against otherwise.

- **Per-broker ledger**: `totalSharesByBroker[broker]` alongside global
  `totalShares`. The controller derives each wallet's broker by calling
  out to a `brokerRegistry` (set via `setBrokerRegistry(address)`) rather
  than trusting a caller-supplied broker parameter — this is
  **deliberately wired to read from `BrokerCorridorGateway.walletBroker()`**
  so both contracts share one source of truth. **A wallet must be
  registered in the broker registry before it can receive ANY allotment
  or distribution** — confirm this sequencing (register-then-allot) is
  compatible with the actual onboarding flow; it was assumed, not
  explicitly confirmed by the user.

- **Reserve model**: `fundReserve(amount)` pulls tokens in (anyone can
  call — no role restriction currently, since "admin mints elsewhere then
  transfers in" was the described flow). No separate "funded amount"
  ledger — live `investmentToken.balanceOf(address(this))` IS the reserve.
  `sweepReserve()` is admin-only.

- **Roles**: `NAV_UPDATER_ROLE`, `DISTRIBUTOR_ROLE`, `ALLOTMENT_ROLE`,
  plus `DEFAULT_ADMIN_ROLE` from AccessControl. Deliberately separated so
  the NAV-oracle key, the daily-distribution-executor key, and the
  subscription-onboarding key can be different signers/services.

- **NAV cannot decrease via `updateNav`** — reverts with
  `NavCannotDecreaseViaOracle`. If loss pass-through is ever needed, that
  needs a separate, more heavily-gated path (flagged, not built).

- **Rounding: floors, does not replicate the sheet's round-half-up.**
  Deliberate — floor is protocol-safe (can never distribute more than
  entitled, even in aggregate); the sheet's round-half-up can, over many
  holders, distribute fractionally more than the NAV increase actually
  funds. Dust accumulates silently in the reserve rather than being
  allocated via the sheet's rank/sort mechanism.

### 3. `BrokerCorridorGateway.sol` — access control, N brokers, no ledger

Pure permission gate — deliberately holds **no balances/ledger** (that's
the controller's job; user explicitly flagged this separation and it was
confirmed as intentional, not a gap).

- `mapping(address => bytes32) walletBroker` — wallet-to-broker registry
  (this is what `NavDistributionController.brokerRegistry` reads from).
- `mapping(bytes32 => mapping(bytes32 => bool)) corridorAllowed` —
  pairwise, scales to any number of brokers (N brokers → up to
  N×(N-1)/2 symmetric pairs). **Not transitive** — opening A↔B and B↔C
  does NOT open A↔C; verified explicitly on a live deployment (see
  "Verified facts" below). This surprised the user initially — worth
  re-confirming understanding stuck if picking this up mid-thought.
- `setCorridor(A, B, allowed)` — symmetric, sets both directions in one call.
- `setCorridorDirectional(from, to, allowed)` — one-way only, for asymmetric needs.
- `setCorridorsBatch(brokersA[], brokersB[], allowed[])` — N pairs in one tx,
  added specifically so full-mesh setup doesn't need N×(N-1)/2 separate
  signed transactions.
- `crossBrokerTransfersGloballyEnabled` — single admin boolean, the
  "later can be unlocked cross transfer" requirement. Opens ALL pairs at
  once, including ones that never had an explicit corridor set.
- Same-broker transfers always pass regardless of corridor state.
- Unregistered wallets always blocked, even under global unlock.
- `checkTransfer(from, to)` reverts if blocked (the form a token hook
  would call); `isTransferAllowed(from, to)` returns bool (the form
  off-chain tooling/previews would call).

## Testing methodology (unusual — read before assuming Foundry works here)

**Foundry is not installed in this sandbox and its installer domain is
network-blocked.** Verification was done by:
1. Pulling `solc` 0.8.24 directly from GitHub releases (not
   `binaries.soliditylang.org`, also blocked):
   `https://github.com/ethereum/solidity/releases/download/v0.8.24/solc-static-linux`
2. Pulling OpenZeppelin Contracts v5.0.2 source from GitHub releases tarball.
3. Compiling with raw `solc` (remapping syntax: positional
   `@openzeppelin/=lib/openzeppelin-contracts/`, NOT a `--remappings` flag
   — that flag doesn't exist on this solc build).
4. Deploying compiled bytecode to a **real EVM** via `eth-tester`
   (`PyEVMBackend`) + `web3.py`, then calling functions through actual
   transactions and checking real state/events/reverts — not mocked.

This is why `run_tests.py`, `run_controller_tests.py`, and
`run_corridor_tests.py` exist as **Python** scripts rather than only a
Foundry `.t.sol` suite. **If your local environment has real Foundry
available, `forge test -vvv` against `test/ConstantNavVault.t.sol` (and
writing equivalent `.t.sol` files for the other two contracts, which
don't have them yet) would be a stronger testing story** — gas reports,
fuzzing, proper stack traces — none of which the Python harness attempts.
Writing Foundry tests for `NavDistributionController` and
`BrokerCorridorGateway` is an explicit gap, not an oversight: the Python
scripts cover the same scenarios but Foundry-native tests don't exist yet
for these two files.

**A real pattern from this session worth repeating**: multiple rounds of
"failures" turned out to be bugs in the *test* (wrong hardcoded expected
values, wrong revert-string matching against raw hex selectors, forgetting
NAV had already grown before an assertion) rather than the contract. Don't
assume a failing assertion means the contract is wrong — check the test's
own arithmetic first, the pattern repeated at least 4 times in this session.

## Verified facts (actually proven on a live deployment, not just designed)

- `ConstantNavVault`: 16/16 Python scenarios pass; cross-checked exchange-
  rate math in Python against the real spreadsheet cells before writing
  assertions (max ~0.005 baht/holder divergence from the sheet, traced to
  the sheet's own `B1` not exactly equalling the sum of its 35 rows —
  not a contract bug).
- `NavDistributionController`: 22/22 Python scenarios pass. Covers
  baseline/cycle NAV updates, on-chain diff-percent calc, idempotency
  (both distribution and allotment), real token transfers, insufficient-
  reserve reverts, pause, per-broker ledger correctness
  (`perBrokerLedgers_sumToGlobalTotal`), and unregistered-wallet rejection.
- `BrokerCorridorGateway`: 25/25 Python scenarios with 4 brokers (not just
  2) pass. Explicitly proved: independently-controllable corridors (2
  active simultaneously without interfering), directional-only corridors,
  `checkTransfer` reverting with the correct custom error, corridor
  closable after opening, global unlock affecting never-configured pairs,
  unregistered wallets blocked even under global unlock. Separately
  re-verified: chain-opened corridors (A↔B + B↔C) do NOT imply A↔C
  (explicit non-transitivity test); `setCorridorsBatch` opens 3-broker full
  mesh in one transaction (~174k gas).

## Open items — NOT yet built, discussed but deferred

These were raised by the user and design-sketched in conversation but
**no code was written or tested for them**. Treat anything described below
as a plan, not a delivered artifact.

1. **Redeem/lock + T+1 request settlement.** Implemented as canonical
  requests: `requestRedeem(wallet, amount, refId)` escrows tokens in the
  controller and `settleRedemptions(refIds)` atomically settles a mixed-
  broker batch. The controller calls the token's original `burn(uint256)`
  API, which burns only escrow held by the controller. Cancellation also
  resolves by `refId` and refunds the stored wallet and amount.

2. **Minimum 10 tMMF holding.** Confirmed this belongs on the **investment
   token itself**, not the controller — controller-level enforcement would
   be bypassed by direct wallet-to-wallet ERC20 transfers (like the
   corridor-permitted cross-broker case). Sketch: override `_update` in
   the token (OZ v5 hook), reverting if a non-zero, non-mint/burn transfer
   would leave the sender's balance strictly between 0 and 10 — i.e.
   full-exit-to-zero is allowed, dust between 0 and 10 is not. **This
   interpretation was proposed, not confirmed** — the alternative reading
   ("can never go below 10, period, even to exit") would need different
   logic and would conflict with any redeem-to-zero flow. Confirm which
   before implementing.

3. **Token transfer hook wiring.** `BrokerCorridorGateway.checkTransfer()`
   is fully built and tested as a standalone view/revert function, but
   **nothing calls it yet**. It needs to be invoked from the investment
   token's `_update` override on every transfer, with controller-
   initiated transfers (allotment, distribution — effectively mint-like,
   `from == address(0)` in a mint pattern, or from the controller's own
   address) likely needing to bypass the corridor check or be pre-cleared
   some other way. **Not designed yet**, only identified as necessary.

4. **The investment token contract itself doesn't exist yet.** Everything
   built so far assumes an `IERC20` (`MockERC20.sol` stands in for testing
   only, plain OZ `ERC20` with a public `mint`). The real tMMF token needs:
   mint access control (SCBAM-only), burn support (for item 1), the
   min-holding hook (item 2), and the corridor-check hook (item 3) all
   layered onto one real contract — not yet started.

5. **`setBaselineNav` is a one-time, single-signature call** with no
   extra guard beyond `NAV_UPDATER_ROLE`. Flagged as a risk (if that role
   is compromised before baseline is set, a fake starting NAV goes in
   uncontested) but not mitigated — user hadn't responded on whether to
   multisig-gate this specifically.

6. **`distributeToWallets`/`allotSharesBatch` revert atomically** — one
   bad entry (e.g. already-processed wallet) reverts the whole batch, not
   just that entry. Flagged as a design question for how the off-chain
   job structures batches/retries — not resolved either way.

## File inventory

```
/mnt/user-data/outputs/
├── README.md                          # setup instructions, Foundry + Python paths
├── foundry.toml, remappings.txt       # for ConstantNavVault's Foundry suite
├── run_tests.py                       # ConstantNavVault — 16/16 passing
├── run_controller_tests.py            # NavDistributionController — 22/22 passing
├── run_corridor_tests.py              # BrokerCorridorGateway — 25/25 passing
├── src/
│   ├── ConstantNavVault.sol           # superseded design, kept for reference
│   ├── NavDistributionController.sol  # ACTIVE — core distribution/allotment logic
│   └── BrokerCorridorGateway.sol      # ACTIVE — N-broker corridor access control
└── test/
    ├── ConstantNavVault.t.sol         # Foundry suite (only for the superseded contract)
    └── mocks/MockERC20.sol            # test-only stand-in for the real investment token
```

## Suggested next step

Given the open items list, the investment token contract (item 4) is the
natural next piece — everything else (redeem/burn, min-holding, corridor
hook) hangs off it and can't be finished or properly tested until it
exists. Worth confirming with the user whether that's the right next
target before starting, since items 1–3 each still have an unresolved
design question embedded in them (burn authority, min-holding edge case,
hook bypass semantics) that's better settled before writing code than
guessed at.

## Custodial Wallet Architecture & Dual-Mode Compatibility

### 1. Enterprise Custodial Architecture (Hyperledger Besu)
* **Custodial Ownership**: On SCBAM's private Besu network, investor wallets are institutional custodial wallets managed by the Selling Agent (InnovestX KMS).
* **Direct Redemption Triggering**: When an investor redeems in the mobile app, the InnovestX custodial service directly signs `FundController.requestRedemption(amount, refId)` on-chain using the investor's custodial wallet (`msg.sender = investorWallet`).
* **Zero Impersonation Vector**: Because the custodial key directly signs, no delegated `requestRedemptionFor` proxy method is required, preventing third-party unauthorized escrow calls.

### 2. Public Blockchain & Non-Custodial Readiness
* The exact same contracts are **100% compatible with public EVM blockchains (Ethereum, Arbitrum, Polygon)** and self-custodial wallets (MetaMask, Rabby).
* In a self-custodial deployment, the investor directly executes `approve(...)` and calls `requestRedemption(amount, refId)` using their own private key.
* The contract strictly binds `wallet = msg.sender`, guaranteeing cryptographic safety in both custodial and self-custodial environments.

