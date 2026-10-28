import { ethers } from "hardhat";

interface WalletInfo {
  address: string;
  broker: string;
  brokerBytes32: string;
  expectedBalance: bigint;
}

async function main() {
  console.log("\n=========================================================================");
  console.log("🚀 HIGH-SCALE STRESS TEST: 1,000 WALLETS MONTE CARLO SIMULATION");
  console.log("=========================================================================\n");

  const [deployer, navUpdater, distributor, allotmentAdmin] = await ethers.getSigners();

  const BROKER_INNOVESTX = ethers.keccak256(ethers.toUtf8Bytes("InnovestX"));
  const BROKER_DIME = ethers.keccak256(ethers.toUtf8Bytes("Dime"));
  const BROKER_THIRD = ethers.keccak256(ethers.toUtf8Bytes("ThirdBroker"));
  const brokers = [BROKER_INNOVESTX, BROKER_DIME, BROKER_THIRD];
  const brokerNames: { [key: string]: string } = {
    [BROKER_INNOVESTX]: "InnovestX",
    [BROKER_DIME]: "Dime",
    [BROKER_THIRD]: "ThirdBroker",
  };

  // 1. Deploy Contracts
  console.log("🛠️ Deploying System Contracts...");
  const Gateway = await ethers.getContractFactory("BrokerCorridorGateway");
  const gateway = await Gateway.deploy(deployer.address);

  const Token = await ethers.getContractFactory("InvestmentTokenM");
  const token = await Token.deploy("Tokenized Mutual Fund", "tMMF", await gateway.getAddress());

  const Controller = await ethers.getContractFactory("FundController");
  const controller = await Controller.deploy(await token.getAddress(), deployer.address);
  await controller.setBrokerRegistry(await gateway.getAddress());

  const Hook = await ethers.getContractFactory("FundComplianceHook");
  const hook = await Hook.deploy(await token.getAddress(), await gateway.getAddress(), await controller.getAddress());
  await hook.setMinHoldingConfig(ethers.parseEther("10"), true);
  await token.setTransferHook(await hook.getAddress());
  await controller.setComplianceHook(await hook.getAddress());

  const REGISTRAR_ROLE = await gateway.REGISTRAR_ROLE();
  const CORRIDOR_ADMIN_ROLE = await gateway.CORRIDOR_ADMIN_ROLE();
  await gateway.grantRole(REGISTRAR_ROLE, deployer.address);
  await gateway.grantRole(CORRIDOR_ADMIN_ROLE, deployer.address);

  await gateway.registerWallet(await controller.getAddress(), BROKER_INNOVESTX);
  await gateway.registerWallet(deployer.address, BROKER_INNOVESTX);

  const NAV_UPDATER_ROLE = await controller.NAV_UPDATER_ROLE();
  const DISTRIBUTOR_ROLE = await controller.DISTRIBUTOR_ROLE();
  const ALLOTMENT_ROLE = await controller.ALLOTMENT_ROLE();
  await controller.grantRole(NAV_UPDATER_ROLE, navUpdater.address);
  await controller.grantRole(DISTRIBUTOR_ROLE, distributor.address);
  await controller.grantRole(ALLOTMENT_ROLE, allotmentAdmin.address);

  // Mint reserve tokens & fund isolated broker reserves
  const reserveAmount = ethers.parseEther("30000000"); // 30M tMMF
  await token.mint(reserveAmount);
  await token.approve(await controller.getAddress(), reserveAmount);

  await controller.fundBrokerReserve(BROKER_INNOVESTX, ethers.parseEther("10000000"));
  await controller.fundBrokerReserve(BROKER_DIME, ethers.parseEther("10000000"));
  await controller.fundBrokerReserve(BROKER_THIRD, ethers.parseEther("10000000"));
  console.log("   ✅ Funded Isolated Broker Reserves (10M tMMF each for InnovestX, Dime, ThirdBroker).");

  // Open Corridors
  await gateway.setCorridor(BROKER_INNOVESTX, BROKER_DIME, true);

  // 2. Generate 1,000 Random Investor Wallets
  console.log("\n👥 Generating 1,000 Investor Wallets...");
  const wallets: WalletInfo[] = [];

  for (let i = 0; i < 1000; i++) {
    const randomAddr = ethers.Wallet.createRandom().address;
    const bBytes32 = brokers[i % 3];
    wallets.push({
      address: randomAddr,
      broker: brokerNames[bBytes32],
      brokerBytes32: bBytes32,
      expectedBalance: 0n,
    });
  }

  // Register 1,000 wallets in batches of 100
  for (let b = 0; b < 1000; b += 100) {
    const batchAddrs = wallets.slice(b, b + 100).map((w) => w.address);
    const batchBrokers = wallets.slice(b, b + 100).map((w) => w.brokerBytes32);
    await gateway.registerWalletsBatch(batchAddrs, batchBrokers);
  }
  console.log("   ✅ Registered 1,000 wallets into Gateway registry (in 10 batches of 100).");

  // 3. Initial Subscriptions Allotment (1,000 Wallets)
  console.log("\n📥 Phase 1: Allotting Initial Subscriptions for 1,000 Wallets...");
  for (let b = 0; b < 1000; b += 100) {
    const batchAddrs = wallets.slice(b, b + 100).map((w) => w.address);
    const batchAmts: bigint[] = [];
    const batchSubIds: string[] = [];

    for (let i = b; i < b + 100; i++) {
      const amt = ethers.parseEther((Math.floor(Math.random() * 1950) + 50).toString());
      batchAmts.push(amt);
      batchSubIds.push(ethers.id(`INIT-SUB-1000-${i}`));
      wallets[i].expectedBalance = amt;
    }

    await controller.connect(allotmentAdmin).allotSharesBatch(batchAddrs, batchAmts, batchSubIds);
  }
  console.log("   ✅ Allotments completed for all 1,000 wallets.");

  // 4. Phase 2: Execute 300 Random Operations
  console.log("\n⚡ Phase 2: Executing 300 Random Operations...");
  let allottedOps = 0;
  let corridorToggles = 0;

  for (let op = 0; op < 300; op++) {
    const action = Math.floor(Math.random() * 2);

    if (action === 0) {
      // Mid-stream subscription allotment to a random wallet out of 1,000
      const idx = Math.floor(Math.random() * 1000);
      const amt = ethers.parseEther((Math.floor(Math.random() * 500) + 50).toString());
      const subId = ethers.id(`OP-SUB-1000-${op}`);
      await controller.connect(allotmentAdmin).allotShares(wallets[idx].address, amt, subId);
      wallets[idx].expectedBalance += amt;
      allottedOps++;
    } else if (action === 1) {
      // Toggle Corridor matrix
      const open = Math.random() > 0.5;
      await gateway.setCorridor(BROKER_INNOVESTX, BROKER_THIRD, open);
      corridorToggles++;
    }
  }
  console.log(`   ✅ 300 Random Operations Executed! (${allottedOps} mid-stream allotments, ${corridorToggles} corridor toggles).`);

  // 5. Phase 3: NAV Growth & Push Distribution (+3.50%)
  console.log("\n📈 Phase 3: Pushing Daily NAV Growth (+3.50%)...");

  let totalActiveBaseline = 0n;
  for (const w of wallets) {
    totalActiveBaseline += w.expectedBalance;
  }
  console.log(`   • Total 1,000-Wallet Baseline Balance: ${ethers.formatEther(totalActiveBaseline)} tMMF`);

  await controller.connect(navUpdater).setBaselineNav(totalActiveBaseline);

  const growthNav = (totalActiveBaseline * 10350n) / 10000n; // +3.5%
  const cycleId = 99999;
  await controller.connect(navUpdater).updateNav(
    cycleId,
    growthNav,
    await ethers.provider.getBlockNumber(),
    ethers.id("snapshot-1000-wallets.csv")
  );

  const cycleData = await controller.cycles(cycleId);
  console.log(`   • NAV Oracle Updated Cycle #${cycleId}: ${ethers.formatEther(growthNav)} tMMF (${cycleData.diffPercentScaled} scaled diff)`);

  console.log("   🚀 Distributing NAV Growth to all 1,000 wallets (10 batches of 100)...");
  for (let b = 0; b < 1000; b += 100) {
    const batch = wallets.slice(b, b + 100);
    const batchAddrs = batch.map((w) => w.address);
    const reportedBalances = batch.map((w) => w.expectedBalance);
    await controller.connect(distributor).distributeToWallets(batchAddrs, cycleId, reportedBalances);
  }

  // Calculate off-chain expected post-distribution balances
  const PRECISION = 10_000_000_000n;
  for (const w of wallets) {
    const earned = (w.expectedBalance * cycleData.diffPercentScaled) / PRECISION;
    w.expectedBalance += earned;
  }

  // 6. Phase 4: Full 1,000-Wallet Reconciliation Audit
  console.log("\n🔍 Phase 4: Performing Full 1,000-Wallet Reconciliation Audit...");
  let mismatchCount = 0;

  for (let i = 0; i < 1000; i++) {
    const w = wallets[i];
    const actualBal = await token.balanceOf(w.address);

    if (actualBal !== w.expectedBalance) {
      console.error(`   ❌ MISMATCH on Wallet #${i} (${w.address}): Expected ${w.expectedBalance}, Actual ${actualBal}`);
      mismatchCount++;
    }
  }

  const totalSharesOnChain = await controller.totalShares();
  let expectedTotalSharesSum = 0n;
  for (const w of wallets) {
    expectedTotalSharesSum += w.expectedBalance;
  }

  console.log("\n=========================================================================");
  console.log("📊 1,000-WALLET MONTE CARLO AUDIT SUMMARY");
  console.log("=========================================================================");
  console.log(`• Wallet Balances Audit (1000/1000)  : ${mismatchCount === 0 ? "100% PERFECT MATCH ✅ (0 wei discrepancy)" : `${mismatchCount} MISMATCHES ❌`}`);
  console.log(`• Sum of 1,000 Live Wallet Holdings  : ${ethers.formatEther(expectedTotalSharesSum)} tMMF`);
  console.log(`• Controller Total Shares On-Chain   : ${ethers.formatEther(totalSharesOnChain)} tMMF`);
  console.log("=========================================================================\n");

  if (mismatchCount === 0 && expectedTotalSharesSum === totalSharesOnChain) {
    console.log("🎉 1,000-WALLET STRESS TEST COMPLETED WITH 100% MATHEMATICAL PRECISION!");
  } else {
    throw new Error("1,000-Wallet Audit failed with discrepancies!");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
