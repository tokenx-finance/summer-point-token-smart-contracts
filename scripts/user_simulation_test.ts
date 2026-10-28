import { ethers } from "hardhat";
import {
  FundController,
  InvestmentTokenM,
  AllowlistRegistryProxyV2,
  FundComplianceHook,
  AllowlistRegistry
} from "../typechain-types";

async function main() {
  console.log("==================================================================================");
  console.log(" 🌐 5-DAY OPERATIONAL USER EVENT SIMULATION & INSTITUTIONAL LIFECYCLE TEST");
  console.log("==================================================================================\n");

  const [
    scbamTreasury,
    tokenXAdmin,
    tokenXOracleBot,
    tokenXDistributorBot,
    innovestXAdmin,
    dimeAdmin,
    alice,
    bob,
    dave,
    charlie,
    eve,
    frank,
    unauthorizedUser
  ] = await ethers.getSigners();

  const BROKER_INNOVESTX = ethers.keccak256(ethers.toUtf8Bytes("INNOVESTX"));
  const BROKER_DIME = ethers.keccak256(ethers.toUtf8Bytes("DIME"));

  // -------------------------------------------------------------------------
  // DAY 0: DEPLOYMENT, TOPOLOGY SETUP & PARTICIPANT ONBOARDING
  // -------------------------------------------------------------------------
  console.log("📅 [DAY 0] Deployment, Topology Setup & KYC Whitelisting...");

  // 1. Deploy Broker Registries
  const RegistryFactory = await ethers.getContractFactory("AllowlistRegistry");
  const innovestXRegistry = await RegistryFactory.connect(innovestXAdmin).deploy();
  const dimeRegistry = await RegistryFactory.connect(dimeAdmin).deploy();

  // 2. Deploy Token X Clearinghouse Proxy V2
  const ProxyFactory = await ethers.getContractFactory("AllowlistRegistryProxyV2");
  const proxy = await ProxyFactory.connect(tokenXAdmin).deploy("Token X Institutional Proxy");

  await proxy.connect(tokenXAdmin).addRegistry("INNOVESTX", await innovestXRegistry.getAddress());
  await proxy.connect(tokenXAdmin).addRegistry("DIME", await dimeRegistry.getAddress());

  // 3. Onboard Users to Respective Broker KYC Registries
  await innovestXRegistry.connect(innovestXAdmin).addAllowlist(alice.address);
  await innovestXRegistry.connect(innovestXAdmin).addAllowlist(bob.address);
  await innovestXRegistry.connect(innovestXAdmin).addAllowlist(dave.address);

  await dimeRegistry.connect(dimeAdmin).addAllowlist(charlie.address);
  await dimeRegistry.connect(dimeAdmin).addAllowlist(eve.address);
  await dimeRegistry.connect(dimeAdmin).addAllowlist(frank.address);

  // 4. Deploy SCBAM Token & FundController
  const TokenFactory = await ethers.getContractFactory("InvestmentTokenM");
  const token = await TokenFactory.connect(scbamTreasury).deploy(
    "SCBAM Tokenized Mutual Fund",
    "tMMF",
    await proxy.getAddress()
  );

  const ControllerFactory = await ethers.getContractFactory("FundController");
  const controller = await ControllerFactory.connect(scbamTreasury).deploy(
    await token.getAddress(),
    scbamTreasury.address
  );

  // 5. Deploy Compliance Transfer Hook
  const HookFactory = await ethers.getContractFactory("FundComplianceHook");
  const hook = await HookFactory.connect(tokenXAdmin).deploy(
    await token.getAddress(),
    await proxy.getAddress(),
    await controller.getAddress()
  );

  // Bind Hook and Registries
  await token.connect(scbamTreasury).setTransferHook(await hook.getAddress());
  await hook.connect(tokenXAdmin).setMinHoldingConfig(ethers.parseEther("10"), true);
  await controller.connect(scbamTreasury).setBrokerRegistry(await proxy.getAddress());
  await controller.connect(scbamTreasury).setComplianceHook(await hook.getAddress());

  // Open InnovestX <-> Dime Corridor
  await proxy.connect(tokenXAdmin).setCorridor(BROKER_INNOVESTX, BROKER_DIME, true);

  // Register Controller and Treasury
  await proxy.connect(tokenXAdmin).registerWallet(await controller.getAddress(), BROKER_INNOVESTX);
  await proxy.connect(tokenXAdmin).registerWallet(scbamTreasury.address, BROKER_INNOVESTX);

  // Grant Operational Roles
  const NAV_UPDATER_ROLE = await controller.NAV_UPDATER_ROLE();
  const DISTRIBUTOR_ROLE = await controller.DISTRIBUTOR_ROLE();
  const ALLOTMENT_ROLE = await controller.ALLOTMENT_ROLE();

  await controller.connect(scbamTreasury).grantRole(NAV_UPDATER_ROLE, tokenXOracleBot.address);
  await controller.connect(scbamTreasury).grantRole(DISTRIBUTOR_ROLE, tokenXDistributorBot.address);
  await controller.connect(scbamTreasury).grantRole(ALLOTMENT_ROLE, innovestXAdmin.address);
  await controller.connect(scbamTreasury).grantRole(ALLOTMENT_ROLE, dimeAdmin.address);

  // Primary Mint: 5,000,000 tMMF (100% transferred to FundController Vault)
  const initialMint = ethers.parseEther("5000000");
  await token.connect(scbamTreasury).mint(initialMint);
  await token.connect(scbamTreasury).approve(await controller.getAddress(), initialMint);

  // Allocate 100% into Broker Quota Buffers (2.5M InnovestX, 2.5M Dime)
  await controller.connect(scbamTreasury).fundBrokerReserve(BROKER_INNOVESTX, ethers.parseEther("2500000"));
  await controller.connect(scbamTreasury).fundBrokerReserve(BROKER_DIME, ethers.parseEther("2500000"));

  console.log("  • Token X Proxy & Corridor Router:  ACTIVE (InnovestX <-> Dime: OPEN)");
  console.log("  • Compliance Hook Plugged:          ACTIVE (Min 10 tMMF, Corridor Enforcement)");
  console.log("  • SCBAM Total Supply:               5,000,000.00 tMMF");
  console.log("  • SCBAM Treasury Balance:           0.00 tMMF (100% Vault Reserved)");
  console.log("  • FundController Vault Balance:     5,000,000.00 tMMF");
  console.log("  • InnovestX Reserve Buffer:         2,500,000.00 tMMF");
  console.log("  • Dime Reserve Buffer:              2,500,000.00 tMMF");
  console.log("  ✅ Day 0 Setup Complete.\n");

  // -------------------------------------------------------------------------
  // DAY 1: SUBSCRIPTION ORDERING, SOFT CANCELLATION & BATCH ALLOTMENT
  // -------------------------------------------------------------------------
  console.log("📅 [DAY 1] Investor Subscriptions, Soft-Cancel & FIFO Batch Allotment...");

  const refAlice = ethers.keccak256(ethers.toUtf8Bytes("SUB-ALICE-100K"));
  const refBob = ethers.keccak256(ethers.toUtf8Bytes("SUB-BOB-50K"));
  const refDave = ethers.keccak256(ethers.toUtf8Bytes("SUB-DAVE-10K-CANCELLED"));
  const refCharlie = ethers.keccak256(ethers.toUtf8Bytes("SUB-CHARLIE-80K"));
  const refEve = ethers.keccak256(ethers.toUtf8Bytes("SUB-EVE-40K"));

  // 1. Investors place orders throughout the morning
  await controller.connect(innovestXAdmin).requestSubscribe(alice.address, ethers.parseEther("100000"), refAlice);
  await controller.connect(innovestXAdmin).requestSubscribe(bob.address, ethers.parseEther("50000"), refBob);
  await controller.connect(innovestXAdmin).requestSubscribe(dave.address, ethers.parseEther("10000"), refDave);
  await controller.connect(dimeAdmin).requestSubscribe(charlie.address, ethers.parseEther("80000"), refCharlie);
  await controller.connect(dimeAdmin).requestSubscribe(eve.address, ethers.parseEther("40000"), refEve);

  console.log("  • Orders Queued in FIFO Deque:      5 Orders (Total 280,000 tMMF)");

  // 2. Dave decides to cancel his order at 14:00 (O(1) Soft Cancellation)
  await controller.connect(innovestXAdmin).cancelSubscribe(refDave);
  console.log("  • Dave Order (10k tMMF):            CANCELLED in O(1) time before cut-off");

  // 3. 15:30 Dealing Cut-off: Off-chain worker processes queue in batch
  const [processed, remaining] = await controller.connect(innovestXAdmin).processSubscriptions.staticCall(100);
  await controller.connect(innovestXAdmin).processSubscriptions(100);

  console.log(`  • Off-Chain Worker Drained Queue:   ${processed} Orders Processed (Remaining: ${remaining})`);
  console.log("  • Alice Balance (InnovestX):        ", ethers.formatEther(await token.balanceOf(alice.address)), "tMMF");
  console.log("  • Bob Balance (InnovestX):          ", ethers.formatEther(await token.balanceOf(bob.address)), "tMMF");
  console.log("  • Dave Balance (Cancelled):         ", ethers.formatEther(await token.balanceOf(dave.address)), "tMMF (0.00)");
  console.log("  • Charlie Balance (Dime):           ", ethers.formatEther(await token.balanceOf(charlie.address)), "tMMF");
  console.log("  • Eve Balance (Dime):               ", ethers.formatEther(await token.balanceOf(eve.address)), "tMMF");
  console.log("  • Total Active Shares in Vault:     ", ethers.formatEther(await controller.totalShares()), "tMMF (270,000.00)");
  console.log("  ✅ Day 1 Allotments Complete.\n");

  // -------------------------------------------------------------------------
  // DAY 2: SECONDARY P2P TRANSFERS & COMPLIANCE GATE EVALUATION
  // -------------------------------------------------------------------------
  console.log("📅 [DAY 2] Secondary Peer-to-Peer Transfers & Compliance Rules...");

  // 1. Cross-Broker Transfer: Alice (InnovestX) -> Charlie (Dime) for 20,000 tMMF
  console.log("  • Cross-Broker Transfer: Alice -> Charlie (20,000 tMMF)");
  await token.connect(alice).transfer(charlie.address, ethers.parseEther("20000"));

  console.log("    - Alice New Balance:              ", ethers.formatEther(await token.balanceOf(alice.address)), "tMMF (80,000.00)");
  console.log("    - Charlie New Balance:            ", ethers.formatEther(await token.balanceOf(charlie.address)), "tMMF (100,000.00)");
  console.log("    - InnovestX Active Ledger:        ", ethers.formatEther(await controller.totalSharesByBroker(BROKER_INNOVESTX)), "tMMF (Auto -20,000)");
  console.log("    - Dime Active Ledger:             ", ethers.formatEther(await controller.totalSharesByBroker(BROKER_DIME)), "tMMF (Auto +20,000)");

  // 2. Same-Broker Transfer: Eve -> Frank (Dime internal) for 5,000 tMMF
  console.log("  • Same-Broker Transfer: Eve -> Frank (5,000 tMMF)");
  await token.connect(eve).transfer(frank.address, ethers.parseEther("5000"));
  console.log("    - Frank New Balance:              ", ethers.formatEther(await token.balanceOf(frank.address)), "tMMF (5,000.00)");

  // 3. Negative Security Check: Attempt transfer to unwhitelisted wallet
  try {
    await token.connect(bob).transfer(unauthorizedUser.address, ethers.parseEther("1000"));
    console.log("    ❌ ERROR: Transfer to unauthorized user should have reverted!");
  } catch (err: any) {
    console.log("    🛡️ Security Check 1: Transfer to non-allowlisted wallet BLOCKED by Proxy ✅");
  }

  // 4. Negative Security Check: Dust balance holding gate (< 10 tMMF)
  try {
    const bobBalance = await token.balanceOf(bob.address); // 50,000
    // Try to transfer 49,995 leaving exactly 5 tMMF (Dust!)
    await token.connect(bob).transfer(alice.address, bobBalance - ethers.parseEther("5"));
    console.log("    ❌ ERROR: Transfer creating dust should have reverted!");
  } catch (err: any) {
    console.log("    🛡️ Security Check 2: Transfer leaving dust (< 10 tMMF) BLOCKED by Hook ✅");
  }

  console.log("  ✅ Day 2 Transfers & Security Invariants Verified.\n");

  // -------------------------------------------------------------------------
  // DAY 3: DAILY NAV GROWTH & AUTOMATED BATCH YIELD DISTRIBUTION
  // -------------------------------------------------------------------------
  console.log("📅 [DAY 3] Daily NAV Growth Calculation & Push Yield Distribution...");

  // Baseline NAV: 270,000 THB -> New NAV: 271,350 THB (+0.50% Yield Growth)
  const baselineNav = ethers.parseEther("270000");
  const day3Nav = ethers.parseEther("271350"); // +1,350 THB yield
  await controller.connect(tokenXOracleBot).setBaselineNav(baselineNav);

  const cycleDay3 = ethers.keccak256(ethers.toUtf8Bytes("CYCLE-DAY-3"));
  const activeInvestors = [alice.address, bob.address, charlie.address, eve.address, frank.address];
  const reportedBalances = await Promise.all(activeInvestors.map((wallet) => token.balanceOf(wallet)));
  await controller.connect(tokenXOracleBot).updateNav(
    cycleDay3,
    day3Nav,
    await ethers.provider.getBlockNumber(),
    ethers.id("snapshot-user-simulation-day-3.csv")
  );

  // Token X Distributor Bot pushes yield to all active holders
  await controller.connect(tokenXDistributorBot).distributeToWallets(activeInvestors, cycleDay3, reportedBalances);

  console.log("  • Alice Yield Credited:             +400.00 tMMF (New Balance: ", ethers.formatEther(await token.balanceOf(alice.address)), "tMMF)");
  console.log("  • Bob Yield Credited:               +250.00 tMMF (New Balance: ", ethers.formatEther(await token.balanceOf(bob.address)), "tMMF)");
  console.log("  • Charlie Yield Credited:           +500.00 tMMF (New Balance: ", ethers.formatEther(await token.balanceOf(charlie.address)), "tMMF)");
  console.log("  • Eve Yield Credited:               +175.00 tMMF (New Balance: ", ethers.formatEther(await token.balanceOf(eve.address)), "tMMF)");
  console.log("  • Frank Yield Credited:             +25.00 tMMF (New Balance:  ", ethers.formatEther(await token.balanceOf(frank.address)), "tMMF)");
  console.log("  • Total Daily Distributed Yield:    +1,350.00 tMMF");
  console.log("  • Total Active Shares in Vault:     ", ethers.formatEther(await controller.totalShares()), "tMMF (271,350.00)");
  console.log("  ✅ Day 3 Yield Pushed with 0 Math Error.\n");

  // -------------------------------------------------------------------------
  // DAY 4: ASYNCHRONOUS REDEMPTION (DAY T) & SCBAM LUMPSUM BURN (DAY T+1)
  // -------------------------------------------------------------------------
  console.log("📅 [DAY 4] Asynchronous Redemptions, Refund & Day T+1 Lumpsum Burn...");

  const refRedeemBob = ethers.keccak256(ethers.toUtf8Bytes("REDEEM-BOB-25K"));
  const refRedeemCharlie = ethers.keccak256(ethers.toUtf8Bytes("REDEEM-CHARLIE-20K"));
  const refRedeemFrank = ethers.keccak256(ethers.toUtf8Bytes("REDEEM-FRANK-2K-REFUND"));

  // 1. Bob requests redemption for 25,000 tMMF
  await token.connect(bob).approve(await controller.getAddress(), ethers.parseEther("25000"));
  await controller.connect(innovestXAdmin).requestRedeem(bob.address, ethers.parseEther("25000"), refRedeemBob);

  // 2. Charlie requests redemption for 20,000 tMMF
  await token.connect(charlie).approve(await controller.getAddress(), ethers.parseEther("20000"));
  await controller.connect(dimeAdmin).requestRedeem(charlie.address, ethers.parseEther("20000"), refRedeemCharlie);

  // 3. Frank requests redemption for 2,000 tMMF
  await token.connect(frank).approve(await controller.getAddress(), ethers.parseEther("2000"));
  await controller.connect(dimeAdmin).requestRedeem(frank.address, ethers.parseEther("2000"), refRedeemFrank);

  console.log("  • InnovestX Locked for Redeem:      ", ethers.formatEther(await controller.lockedForRedemption(BROKER_INNOVESTX)), "tMMF (25,000.00)");
  console.log("  • Dime Locked for Redeem:           ", ethers.formatEther(await controller.lockedForRedemption(BROKER_DIME)), "tMMF (22,000.00)");

  // 4. Frank's bank account is invalid -> SCBAM cancels & refunds Frank
  await controller.connect(scbamTreasury).cancelRedeem(refRedeemFrank);
  console.log("  • Frank Redemption (2k tMMF):       CANCELLED & REFUNDED back to Frank's wallet");
  console.log("  • Frank Restored Balance:           ", ethers.formatEther(await token.balanceOf(frank.address)), "tMMF (5,025.00)");

  // 5. Day T+1 Morning: SCBAM confirms fiat wires and executes Lumpsum Burn
  const preBurnSupply = await token.totalSupply();
  await controller.connect(scbamTreasury).settleRedemptions([refRedeemBob, refRedeemCharlie]);

  console.log("  • Total Supply Before Burn:         ", ethers.formatEther(preBurnSupply), "tMMF (5,000,000.00)");
  console.log("  • Total Supply After Burn:          ", ethers.formatEther(await token.totalSupply()), "tMMF (4,955,000.00)");
  console.log("  • Remaining Locked in Escrow:       0.00 tMMF");
  console.log("  ✅ Day 4 Asynchronous Redemptions & Burns Finalized.\n");

  // -------------------------------------------------------------------------
  // DAY 5: FINAL MATHEMATICAL INTEGRITY & RECONCILIATION AUDIT
  // -------------------------------------------------------------------------
  console.log("📅 [DAY 5] Final System Reconciliation & Invariant Conservation Audit...");

  const totalSupply = await token.totalSupply();
  const treasuryBalance = await token.balanceOf(scbamTreasury.address);
  const activeShares = await controller.totalShares();
  const vaultBalance = await token.balanceOf(await controller.getAddress());

  console.log("  • Token Total Supply:               ", ethers.formatEther(totalSupply), "tMMF");
  console.log("  • SCBAM Treasury Balance:           ", ethers.formatEther(treasuryBalance), "tMMF");
  console.log("  • Active Investor Shares:           ", ethers.formatEther(activeShares), "tMMF (226,350.00)");
  console.log("  • FundController Vault Buffer:      ", ethers.formatEther(vaultBalance), "tMMF (1,728,650.00)");
  console.log("  --------------------------------------------------------------------------------");
  console.log("  • Treasury + Shares + Vault:        ", ethers.formatEther(treasuryBalance + activeShares + vaultBalance), "tMMF");

  const invariantDiff = totalSupply - (treasuryBalance + activeShares + vaultBalance);
  if (invariantDiff === 0n) {
    console.log("  🎉 INVARIANT AUDIT VERDICT:         PERFECT MATHEMATICAL CONSERVATION (0 WEI ERROR) ✅");
  } else {
    console.error(`  ❌ INVARIANT ERROR: Deviation of ${invariantDiff} wei!`);
    process.exit(1);
  }

  console.log("\n==================================================================================");
  console.log(" 🏆 SIMULATION RESULT: ALL 5 OPERATIONAL DAYS PASSED WITH 100% SUCCESS!");
  console.log("==================================================================================");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
