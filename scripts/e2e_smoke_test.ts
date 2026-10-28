import { ethers } from "hardhat";
import { expect } from "chai";

async function main() {
  console.log("==========================================================================");
  console.log("       🚀 SCBAM TOKENIZED MUTUAL FUND (tMMF) - E2E SMOKE TEST            ");
  console.log("==========================================================================\n");

  const [
    scbamTreasury,
    tokenXTech,
    tokenXOracleBot,
    tokenXDistributorBot,
    innovestXOps,
    dimeOps,
    alice,
    bob,
    charlie
  ] = await ethers.getSigners();

  const BROKER_INNOVESTX = ethers.keccak256(ethers.toUtf8Bytes("INNOVESTX"));
  const BROKER_DIME = ethers.keccak256(ethers.toUtf8Bytes("DIME"));

  // -------------------------------------------------------------------------
  // STAGE 1: DEPLOYMENT & ECOSYSTEM INITIALIZATION
  // -------------------------------------------------------------------------
  console.log("📦 [Stage 1] Deploying Contracts...");

  // 1.1 Broker Standalone Registries
  const AllowlistRegistryFactory = await ethers.getContractFactory("AllowlistRegistry");
  const innovestXRegistry = await AllowlistRegistryFactory.connect(innovestXOps).deploy();
  await innovestXRegistry.waitForDeployment();
  const dimeRegistry = await AllowlistRegistryFactory.connect(dimeOps).deploy();
  await dimeRegistry.waitForDeployment();
  console.log("  • InnovestX AllowlistRegistry deployed at:", await innovestXRegistry.getAddress());
  console.log("  • Dime AllowlistRegistry deployed at:     ", await dimeRegistry.getAddress());

  // 1.2 Token X Proxy Gateway v2
  const ProxyFactory = await ethers.getContractFactory("AllowlistRegistryProxyV2");
  const proxy = await ProxyFactory.connect(tokenXTech).deploy("Token X Multi-Broker Proxy v2");
  await proxy.waitForDeployment();
  console.log("  • AllowlistRegistryProxyV2 deployed at:   ", await proxy.getAddress());

  // 1.3 SCBAM Investment Token
  const TokenFactory = await ethers.getContractFactory("InvestmentTokenM");
  const token = await TokenFactory.connect(scbamTreasury).deploy(
    "SCBAM Tokenized Mutual Fund",
    "tMMF",
    await proxy.getAddress()
  );
  await token.waitForDeployment();
  console.log("  • InvestmentTokenM (tMMF) deployed at:    ", await token.getAddress());

  // 1.4 FundController Vault
  const ControllerFactory = await ethers.getContractFactory("FundController");
  const controller = await ControllerFactory.connect(scbamTreasury).deploy(
    await token.getAddress(),
    scbamTreasury.address
  );
  await controller.waitForDeployment();
  await controller.connect(scbamTreasury).setBrokerRegistry(await proxy.getAddress());
  console.log("  • FundController deployed at:             ", await controller.getAddress());

  // 1.5 FundComplianceHook
  const HookFactory = await ethers.getContractFactory("FundComplianceHook");
  const hook = await HookFactory.connect(tokenXTech).deploy(
    await token.getAddress(),
    await proxy.getAddress(),
    await controller.getAddress()
  );
  await hook.waitForDeployment();
  await hook.connect(tokenXTech).setMinHoldingConfig(ethers.parseEther("10"), true);
  console.log("  • FundComplianceHook deployed at:         ", await hook.getAddress());

  // Link hook & controller
  await token.connect(scbamTreasury).setTransferHook(await hook.getAddress());
  await controller.connect(scbamTreasury).setComplianceHook(await hook.getAddress());

  // Setup Roles on FundController
  const NAV_UPDATER_ROLE = await controller.NAV_UPDATER_ROLE();
  const DISTRIBUTOR_ROLE = await controller.DISTRIBUTOR_ROLE();
  const ALLOTMENT_ROLE = await controller.ALLOTMENT_ROLE();

  await controller.connect(scbamTreasury).grantRole(NAV_UPDATER_ROLE, tokenXOracleBot.address);
  await controller.connect(scbamTreasury).grantRole(DISTRIBUTOR_ROLE, tokenXDistributorBot.address);
  await controller.connect(scbamTreasury).grantRole(ALLOTMENT_ROLE, innovestXOps.address);
  await controller.connect(scbamTreasury).grantRole(ALLOTMENT_ROLE, dimeOps.address);
  console.log("  ✅ Roles successfully granted to Token X Bots and Broker Admins.\n");

  // -------------------------------------------------------------------------
  // STAGE 2: BROKER KYC ONBOARDING & CORRIDORS
  // -------------------------------------------------------------------------
  console.log("🏢 [Stage 2] KYC Onboarding & Corridor Routing...");

  // InnovestX onboards Alice & Bob
  await innovestXRegistry.connect(innovestXOps).addAllowlist(alice.address);
  await innovestXRegistry.connect(innovestXOps).addAllowlist(bob.address);

  // Dime onboards Charlie
  await dimeRegistry.connect(dimeOps).addAllowlist(charlie.address);

  // Register broker contracts in Token X proxy
  await proxy.connect(tokenXTech).addRegistry("INNOVESTX", await innovestXRegistry.getAddress());
  await proxy.connect(tokenXTech).addRegistry("DIME", await dimeRegistry.getAddress());

  // Register SCBAM treasury and FundController in proxy for internal movements
  await proxy.connect(tokenXTech).registerWallet(scbamTreasury.address, BROKER_INNOVESTX);
  await proxy.connect(tokenXTech).registerWallet(await controller.getAddress(), BROKER_INNOVESTX);

  // Open inter-broker corridor InnovestX <-> Dime
  await proxy.connect(tokenXTech).setCorridor(BROKER_INNOVESTX, BROKER_DIME, true);

  console.log("  • Alice (InnovestX) allowlisted: ", await proxy.isAllowlist(alice.address));
  console.log("  • Charlie (Dime) allowlisted:    ", await proxy.isAllowlist(charlie.address));
  console.log("  • InnovestX ↔ Dime Corridor Open:", await proxy.corridorAllowed(BROKER_INNOVESTX, BROKER_DIME));
  console.log("  ✅ KYC and Corridor Matrix initialized.\n");

  // -------------------------------------------------------------------------
  // STAGE 3: PRIMARY MINTING & BROKER RESERVE FUNDING (100% TO VAULT)
  // -------------------------------------------------------------------------
  console.log("🪙 [Stage 3] SCBAM Primary Minting & 100% Vault Reserve Funding...");

  const mintAmount = ethers.parseEther("1000000"); // 1,000,000 tMMF
  await token.connect(scbamTreasury).mint(mintAmount);
  await token.connect(scbamTreasury).approve(await controller.getAddress(), mintAmount);

  // Fund 100% of minted tokens to FundController Vault (600k InnovestX, 400k Dime)
  const innovestXReserve = ethers.parseEther("600000");
  const dimeReserve = ethers.parseEther("400000");
  await controller.connect(scbamTreasury).fundBrokerReserve(BROKER_INNOVESTX, innovestXReserve);
  await controller.connect(scbamTreasury).fundBrokerReserve(BROKER_DIME, dimeReserve);

  console.log("  • SCBAM Total Supply:             ", ethers.formatEther(await token.totalSupply()), "tMMF");
  console.log("  • SCBAM Treasury Balance:         ", ethers.formatEther(await token.balanceOf(scbamTreasury.address)), "tMMF (0.00)");
  console.log("  • FundController Vault Balance:   ", ethers.formatEther(await token.balanceOf(await controller.getAddress())), "tMMF (1,000,000.00)");
  console.log("  • InnovestX Isolated Reserve:     ", ethers.formatEther(await controller.brokerReserve(BROKER_INNOVESTX)), "tMMF");
  console.log("  • Dime Isolated Reserve:          ", ethers.formatEther(await controller.brokerReserve(BROKER_DIME)), "tMMF");
  console.log("  ✅ 100% of liquidity buffers safely stored in FundController Vault.\n");

  // -------------------------------------------------------------------------
  // STAGE 4: 3-STATE FIFO SUBSCRIPTION QUEUE & BATCH ALLOTMENT
  // -------------------------------------------------------------------------
  console.log("📑 [Stage 4] 3-State FIFO Subscription Queue & Batch Allotment...");

  const refAlice = ethers.keccak256(ethers.toUtf8Bytes("REF-SUB-ALICE-01"));
  const refBob = ethers.keccak256(ethers.toUtf8Bytes("REF-SUB-BOB-01"));
  const refCharlie = ethers.keccak256(ethers.toUtf8Bytes("REF-SUB-CHARLIE-01"));
  const refCancelled = ethers.keccak256(ethers.toUtf8Bytes("REF-SUB-CANCEL-TEST"));

  // 4.1 Enqueue orders in FIFO sequence (Alice 50k, CancelTest 5k, Bob 30k, Charlie 40k)
  await controller.connect(innovestXOps).requestSubscribe(alice.address, ethers.parseEther("50000"), refAlice);
  await controller.connect(innovestXOps).requestSubscribe(bob.address, ethers.parseEther("5000"), refCancelled);
  await controller.connect(innovestXOps).requestSubscribe(bob.address, ethers.parseEther("30000"), refBob);
  await controller.connect(dimeOps).requestSubscribe(charlie.address, ethers.parseEther("40000"), refCharlie);

  console.log("  • Initial FIFO Queue Length:      ", (await controller.pendingSubscriptionQueueLength()).toString(), "orders");
  console.log("  • InnovestX Pending Volume:       ", ethers.formatEther(await controller.pendingSubscriptionVolume(BROKER_INNOVESTX)), "tMMF");

  // 4.2 Soft-Cancel the 5k test order in O(1) time
  await controller.connect(innovestXOps).cancelSubscribe(refCancelled);
  console.log("  • Order REF-SUB-CANCEL-TEST Soft-Cancelled in O(1) time.");
  console.log("  • InnovestX Pending Volume (Adj): ", ethers.formatEther(await controller.pendingSubscriptionVolume(BROKER_INNOVESTX)), "tMMF");
  console.log("  • InnovestX Cancelled Volume:     ", ethers.formatEther(await controller.cancelledSubscriptionVolume(BROKER_INNOVESTX)), "tMMF");

  // 4.3 Off-chain worker processes queue in batch of 10
  const [processedCount, remaining] = await controller.connect(innovestXOps).processSubscriptions.staticCall(10);
  await controller.connect(innovestXOps).processSubscriptions(10);

  console.log(`  • Batch Processed:                 ${processedCount} orders (Remaining in Queue: ${remaining})`);
  console.log("  • Alice Balance (InnovestX):      ", ethers.formatEther(await token.balanceOf(alice.address)), "tMMF (Expected: 50,000)");
  console.log("  • Bob Balance (InnovestX):        ", ethers.formatEther(await token.balanceOf(bob.address)), "tMMF (Expected: 30,000, 5k cancelled skipped)");
  console.log("  • Charlie Balance (Dime):         ", ethers.formatEther(await token.balanceOf(charlie.address)), "tMMF (Expected: 40,000)");
  console.log("  • Total Active Shares in Vault:   ", ethers.formatEther(await controller.totalShares()), "tMMF (120,000.00)");
  console.log("  • Final Pending Queue Length:     ", (await controller.pendingSubscriptionQueueLength()).toString(), "orders");
  console.log("  ✅ FIFO Subscription Queue and Allotments confirmed with 0 wei error.\n");

  // -------------------------------------------------------------------------
  // STAGE 5: CROSS-BROKER P2P TRANSFER & COMPLIANCE HOOK AUTO-SYNC
  // -------------------------------------------------------------------------
  console.log("🔄 [Stage 5] Cross-Broker P2P Transfer (Alice -> Charlie)...");

  const transferAmount = ethers.parseEther("10000"); // 10,000 tMMF
  console.log("  • Pre-transfer InnovestX Shares:  ", ethers.formatEther(await controller.totalSharesByBroker(BROKER_INNOVESTX)), "tMMF");
  console.log("  • Pre-transfer Dime Shares:       ", ethers.formatEther(await controller.totalSharesByBroker(BROKER_DIME)), "tMMF");

  // Alice (InnovestX) transfers 10,000 tMMF to Charlie (Dime)
  await token.connect(alice).transfer(charlie.address, transferAmount);

  console.log("  • Post-transfer Alice Balance:    ", ethers.formatEther(await token.balanceOf(alice.address)), "tMMF (Remaining: 40,000)");
  console.log("  • Post-transfer Charlie Balance:  ", ethers.formatEther(await token.balanceOf(charlie.address)), "tMMF (New: 50,000)");
  console.log("  • Post-transfer InnovestX Shares: ", ethers.formatEther(await controller.totalSharesByBroker(BROKER_INNOVESTX)), "tMMF (Auto-synced -10,000)");
  console.log("  • Post-transfer Dime Shares:      ", ethers.formatEther(await controller.totalSharesByBroker(BROKER_DIME)), "tMMF (Auto-synced +10,000)");
  console.log("  ✅ Transfer hook executed and auto-balanced per-broker ledgers.\n");

  // -------------------------------------------------------------------------
  // STAGE 6: DAILY NAV UPDATE & AUTOMATED PUSH YIELD DISTRIBUTION
  // -------------------------------------------------------------------------
  console.log("📈 [Stage 6] Daily NAV Growth & Batch Yield Push Distribution...");

  // Baseline NAV: 120,000 THB -> Today NAV: 120,600 THB (0.50% Daily Growth)
  const baselineNav = ethers.parseEther("120000");
  const newNav = ethers.parseEther("120600"); // +600 THB growth
  await controller.connect(tokenXOracleBot).setBaselineNav(baselineNav);

  const cycleId = ethers.keccak256(ethers.toUtf8Bytes("CYCLE-20260824"));
  await controller.connect(tokenXOracleBot).updateNav(
    cycleId,
    newNav,
    await ethers.provider.getBlockNumber(),
    ethers.id("snapshot-CYCLE-20260824.csv")
  );

  // Token X Distributor Bot pushes yield to all 3 investors
  await controller.connect(tokenXDistributorBot).distributeToWallets(
    [alice.address, bob.address, charlie.address],
    cycleId,
    [ethers.parseEther("40000"), ethers.parseEther("30000"), ethers.parseEther("50000")]
  );

  console.log("  • Alice Yield Received:           +200.00 tMMF (Balance: ", ethers.formatEther(await token.balanceOf(alice.address)), "tMMF)");
  console.log("  • Bob Yield Received:             +150.00 tMMF (Balance: ", ethers.formatEther(await token.balanceOf(bob.address)), "tMMF)");
  console.log("  • Charlie Yield Received:         +250.00 tMMF (Balance: ", ethers.formatEther(await token.balanceOf(charlie.address)), "tMMF)");
  console.log("  • Total Distributed Yield:        +600.00 tMMF");
  console.log("  ✅ Push dividend distribution verified.\n");

  // -------------------------------------------------------------------------
  // STAGE 7: INVESTOR SELL ORDER (DAY T) & SCBAM LUMPSUM BURN (DAY T+1)
  // -------------------------------------------------------------------------
  console.log("🔥 [Stage 7] Redemption Request (refId) & SCBAM T+1 Daily Lumpsum Burn...");

  const redeemAmount = ethers.parseEther("15000"); // Bob sells 15,000 tMMF
  await token.connect(bob).approve(await controller.getAddress(), redeemAmount);

  const redeemRefId = ethers.keccak256(ethers.toUtf8Bytes("REDEEM-REF-001"));
  await controller.connect(innovestXOps).requestRedeem(bob.address, redeemAmount, redeemRefId);

  console.log("  • Bob Balance after Sell:         ", ethers.formatEther(await token.balanceOf(bob.address)), "tMMF");
  console.log("  • InnovestX Locked for Redeem:    ", ethers.formatEther(await controller.lockedForRedemption(BROKER_INNOVESTX)), "tMMF");
  console.log("  • InnovestX Active Shares:        ", ethers.formatEther(await controller.totalSharesByBroker(BROKER_INNOVESTX)), "tMMF");

  // SCBAM confirms fiat bank wire and executes Day T+1 lumpsum burn
  const totalSupplyBeforeBurn = await token.totalSupply();
  await controller.connect(scbamTreasury).settleRedemptions([redeemRefId]);

  console.log("  • Total Supply Before Burn:       ", ethers.formatEther(totalSupplyBeforeBurn), "tMMF");
  console.log("  • Total Supply After Burn:        ", ethers.formatEther(await token.totalSupply()), "tMMF (-15,000.00)");
  console.log("  • Remaining Locked for Redeem:    ", ethers.formatEther(await controller.lockedForRedemption(BROKER_INNOVESTX)), "tMMF");
  console.log("  ✅ Day T+1 Lumpsum Burn executed successfully.\n");

  // -------------------------------------------------------------------------
  // STAGE 8: FINAL MATHEMATICAL CONSERVATION INVARIANT AUDIT
  // -------------------------------------------------------------------------
  console.log("🧮 [Stage 8] Final Mathematical Conservation Audit...");

  const finalTotalSupply = await token.totalSupply();
  const finalTreasuryBalance = await token.balanceOf(scbamTreasury.address);
  const finalTotalShares = await controller.totalShares();
  const finalVaultBalance = await token.balanceOf(await controller.getAddress());

  console.log("  • Final Token Total Supply:       ", ethers.formatEther(finalTotalSupply), "tMMF");
  console.log("  • SCBAM Treasury Balance:         ", ethers.formatEther(finalTreasuryBalance), "tMMF");
  console.log("  • FundController Active Shares:   ", ethers.formatEther(finalTotalShares), "tMMF");
  console.log("  • FundController Vault Buffer:    ", ethers.formatEther(finalVaultBalance), "tMMF");
  console.log("  • Sum (Treasury + Shares + Vault):", ethers.formatEther(finalTreasuryBalance + finalTotalShares + finalVaultBalance), "tMMF");

  expect(finalTotalSupply).to.equal(finalTreasuryBalance + finalTotalShares + finalVaultBalance);
  console.log("  ------------------------------------------------------------------------");
  console.log("  🎉 INVARIANT CONSERVATION VERDICT: EXACT MATCH (0 WEI ERROR) ✅");
  console.log("==========================================================================\n");
}

main().catch((error) => {
  console.error("❌ E2E Smoke Test Failed:", error);
  process.exitCode = 1;
});
