# Specification: Custodial Wallet Model & Dual-Mode Redemption Architecture

## 1. Executive Summary

This project operates on a **Custodial Wallet Architecture** for its primary enterprise deployment on **Hyperledger Besu (SCBAM & InnovestX)**, while retaining **100% native compatibility with Non-Custodial Wallets** on public EVM blockchains.

---

## 2. Primary Enterprise Deployment: Custodial Wallet Architecture (Hyperledger Besu)

### 2.1 The Operational Model
On SCBAM's private permissioned Hyperledger Besu network:
* **Custodial Infrastructure**: Retail investors do not hold raw private keys or seed phrases. Instead, investor accounts are managed via an institutional Key Management System (KMS / HSM / Fireblocks) operated by the Selling Agent (**InnovestX**).
* **Mobile App Interaction**:
  1. A retail investor logs into the InnovestX mobile app and taps **"Redeem 10,000 tMMF"**.
  2. The user authenticates securely via PIN / Biometrics (FaceID).
  3. The InnovestX custodial backend signs the transaction using **the investor's custodial wallet key**.
  4. The custodial transaction calls `FundController.requestRedemption(amount, refId)` directly on-chain where `msg.sender == investorCustodyWallet`.
  5. `FundController` pulls the tokens from `msg.sender` into vault escrow and locks them for Day T+1 settlement burn.

### 2.2 Why Delegated `requestRedemptionFor` is Unnecessary
* Because the selling agent's custodial service signs directly with the user's custody wallet, **delegated proxy methods (`requestRedemptionFor(wallet, ...)`) are redundant and create unnecessary attack vectors**.
* By strictly binding redemption to `msg.sender`:
  * No third-party can trigger an unwanted redemption escrow on another user's balance.
  * Every redemption creates an authentic cryptographic trace directly attributed to the investor's address.

---

## 3. Public Blockchain & Non-Custodial Wallet Compatibility

The smart contracts are designed to run seamlessly on **Public EVM Blockchains (Ethereum, Arbitrum, Polygon)** with **Self-Custodial Wallets (MetaMask, Rabby, Ledger)**:

### 3.1 Non-Custodial Flow:
If a user holds their own private key in self-custody:
1. **Approval**: The user calls `InvestmentTokenM.approve(address(fundController), amount)` (or sets a one-time onboarding allowance).
2. **Self-Service Redemption**: The user directly calls `FundController.requestRedemption(amount, refId)` from their self-custodial wallet.
3. **Strict Binding**: `FundController` transfers tokens from `msg.sender` to `address(this)`, deducting active shares and recording the `RedemptionRequest` with `wallet = msg.sender`.

### 3.2 Dual-Mode Compatibility Matrix

| Architectural Feature | Private Network (Custodial - InnovestX) | Public Network (Non-Custodial - Self-Custody) |
|---|---|---|
| **Signer** | InnovestX KMS / Custody Signer | Investor's self-custody wallet (MetaMask) |
| **Transaction Origin** | `msg.sender = investorCustodyWallet` | `msg.sender = userSelfCustodyWallet` |
| **Redemption Call** | `requestRedemption(amount, refId)` | `requestRedemption(amount, refId)` |
| **Allowance Model** | Pre-approved during KYC onboarding | Explicit `approve(...)` by user |
| **Impersonation Risk** | **0%** (Cryptographically isolated) | **0%** (Strict `msg.sender` binding) |

---

## 4. Consortium Role-Based Access Control (RBAC) Alignment

The contracts use a streamlined 3-entity authorization matrix:

1. **TokenX (`DEFAULT_ADMIN_ROLE`)**:
   * Technical and infrastructure operator.
   * Role assignment, registry/hook pointers, emergency circuit-breaker pause.
2. **SCBAM (`AM_ROLE`)**:
   * Asset Management Company & Fund Issuer.
   * Token minting (`InvestmentTokenM.mint`), reserve funding (`fundBrokerReserve`), daily NAV pricing oracle (`updateNav`), and Day T+1 fiat settlement burns (`settleRedemptions`).
3. **InnovestX (`SELLING_AGENT_ROLE`)**:
   * Selling Agent & Distributor.
   * Investor subscriptions (`requestSubscribe`), batch share allotments (`allotShares`, `allotSharesBatch`), and daily push yield distributions (`distributeToWallets`).
4. **Investor (`Public / msg.sender`)**:
   * P2P token transfers (subject to KYC allowlist and broker corridors).
   * Direct self-service redemption escrow (`requestRedemption`).
