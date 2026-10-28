import { ethers } from "hardhat";

interface WalletInfo {
  signer: any;
  address: string;
  broker: string;
  brokerBytes32: string;
  expectedBalance: bigint;
}

async function main() {
  console.log("\n=========================================================================");
  console.log("🎲 MONTE CARLO STRESS TEST: 50 WALLETS RANDOM EVENT SIMULATION");
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
  console.log("🛠️ Deploying Contracts...");
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

  const REGISTRAR_ROLE = await gateway.REGISTRAR_ROLE();
  const CORRIDOR_ADMIN_ROLE = await gateway.CORRIDOR_ADMIN_ROLE();
  await gateway.grantRole(REGISTRAR_ROLE, deployer.address);
  await gateway.grantRole(CORRIDOR_ADMIN_ROLE, deployer.address);

  await gateway.registerWallet(await controller.getAddress(), BROKER_INNOVESTX);

  const NAV_UPDATER_ROLE = await controller.NAV_UPDATER_ROLE();
  const DISTRIBUTOR_ROLE = await controller.DISTRIBUTOR_ROLE();
  const ALLOTMENT_ROLE = await controller.ALLOTMENT_ROLE();
  await controller.grantRole(NAV_UPDATER_ROLE, navUpdater.address);
  await controller.grantRole(DISTRIBUTOR_ROLE, distributor.address);
  await controller.grantRole(ALLOTMENT_ROLE, allotmentAdmin.address);

  // Mint reserve tokens to Controller
  const reserveAmount = ethers.parseEther("1000000"); // 1M tMMF
  await token.mint(reserveAmount);
  await token.approve(await controller.getAddress(), reserveAmount);
  await controller.fundBrokerReserve(BROKER_INNOVESTX, ethers.parseEther("400000"));
  await controller.fundBrokerReserve(BROKER_DIME, ethers.parseEther("300000"));
  await controller.fundBrokerReserve(BROKER_THIRD, ethers.parseEther("300000"));

  // Open Corridor InnovestX <-> Dime initially
  await gateway.setCorridor(BROKER_INNOVESTX, BROKER_DIME, true);

  // 2. Generate 50 Random Wallets
  console.log("👥 Generating 50 Mock Investor Wallets...");
  const wallets: WalletInfo[] = [];

  for (let i = 0; i < 50; i++) {
    const randomWallet = ethers.Wallet.createRandom().connect(ethers.provider);
    await deployer.sendTransaction({ to: randomWallet.address, value: ethers.parseEther("1") });

    const brokerBytes32 = brokers[i % 3]; // Distribute evenly across 3 brokers
    wallets.push({
      signer: randomWallet,
      address: randomWallet.address,
      broker: brokerNames[brokerBytes32],
      brokerBytes32: brokerBytes32,
      expectedBalance: 0n,
    });
  }

  // Register all 50 wallets in BrokerCorridorGateway
  const addrs = wallets.map((w) => w.address);
  const brokerList = wallets.map((w) => w.brokerBytes32);
  await gateway.registerWalletsBatch(addrs, brokerList);
  console.log("   ✅ Registered 50 wallets into Gateway registry.");

  // 3. Phase 1: Allot Initial Subscriptions
  console.log("\n📥 Phase 1: Initial Subscription Allotment (50 Wallets)...");
  const initialAllotments: bigint[] = [];
  const subIds: string[] = [];

  for (let i = 0; i < 50; i++) {
    const amount = ethers.parseEther((Math.floor(Math.random() * 1900) + 100).toString());
    initialAllotments.push(amount);
    subIds.push(ethers.id(`INIT-SUB-${i}`));
    wallets[i].expectedBalance = amount;
  }

  await controller.connect(allotmentAdmin).allotSharesBatch(addrs.slice(0, 25), initialAllotments.slice(0, 25), subIds.slice(0, 25));
  await controller.connect(allotmentAdmin).allotSharesBatch(addrs.slice(25, 50), initialAllotments.slice(25, 50), subIds.slice(25, 50));
  console.log("   ✅ Initial Allotments completed for all 50 wallets.");

  // 4. Phase 2: Execute 150 Randomized User Transactions
  console.log("\n⚡ Phase 2: Executing 150 Random Operations (Transfers, Allotments, Redemptions)...");
  let successfulTransfers = 0;
  let blockedTransfers = 0;
  let totalRedemptions = 0;

  for (let step = 0; step < 150; step++) {
    const actionType = Math.floor(Math.random() * 4);

    if (actionType === 0) {
      const fromIdx = Math.floor(Math.random() * 50);
      let toIdx = Math.floor(Math.random() * 50);
      while (toIdx === fromIdx) toIdx = Math.floor(Math.random() * 50);

      const fromW = wallets[fromIdx];
      const toW = wallets[toIdx];

      if (fromW.expectedBalance >= ethers.parseEther("20")) {
        const transferAmt = fromW.expectedBalance / 2n;

        const isAllowed = await gateway.isTransferAllowed(fromW.address, toW.address);
        const postFrom = fromW.expectedBalance - transferAmt;
        const postTo = toW.expectedBalance + transferAmt;
        const min10 = ethers.parseEther("10");

        const minValid = (postFrom === 0n || postFrom >= min10) && (postTo >= min10);

        try {
          const tokenAsFrom = token.connect(fromW.signer);
          const tx = await tokenAsFrom.transfer(toW.address, transferAmt);
          await tx.wait();

          if (isAllowed && minValid) {
            fromW.expectedBalance -= transferAmt;
            toW.expectedBalance += transferAmt;
            successfulTransfers++;
          }
        } catch (err) {
          blockedTransfers++;
        }
      }
    } else if (actionType === 1) {
      const targetIdx = Math.floor(Math.random() * 50);
      const allotAmt = ethers.parseEther((Math.floor(Math.random() * 500) + 50).toString());
      const subId = ethers.id(`RAND-SUB-${step}`);

      await controller.connect(allotmentAdmin).allotShares(wallets[targetIdx].address, allotAmt, subId);
      wallets[targetIdx].expectedBalance += allotAmt;
    } else if (actionType === 2) {
      const targetIdx = Math.floor(Math.random() * 50);
      const w = wallets[targetIdx];
      if (w.expectedBalance >= ethers.parseEther("50")) {
        const redeemAmt = ethers.parseEther("20");
        const redeemId = ethers.id(`RAND-REDEEM-${step}`);

        await token.connect(w.signer).approve(await controller.getAddress(), redeemAmt);
        await controller.connect(allotmentAdmin).requestRedeem(w.address, redeemAmt, redeemId);

        w.expectedBalance -= redeemAmt;
        totalRedemptions++;
      }
    } else if (actionType === 3) {
      const open = Math.random() > 0.5;
      await gateway.setCorridor(BROKER_INNOVESTX, BROKER_THIRD, open);
    }
  }

  console.log(`   ✅ 150 Operations Completed!`);
  console.log(`   • Successful Transfers: ${successfulTransfers}`);
  console.log(`   • Blocked Transfers   : ${blockedTransfers}`);
  console.log(`   • Redemptions Processed: ${totalRedemptions}`);

  // 5. Phase 3: NAV Growth & Push Distribution (Day 1: +4.25% Growth)
  console.log("\n📈 Phase 3: Pushing Daily NAV Growth (+4.25%)...");

  let totalActiveOffChain = 0n;
  for (const w of wallets) {
    totalActiveOffChain += w.expectedBalance;
  }

  console.log(`   • Total Active Wallet Balances Baseline: ${ethers.formatEther(totalActiveOffChain)} tMMF`);

  await controller.connect(navUpdater).setBaselineNav(totalActiveOffChain);

  const growthMultiplier = 10425n;
  const dayNav = (totalActiveOffChain * growthMultiplier) / 10000n;
  const cycleId = 8888;

  await controller.connect(navUpdater).updateNav(
    cycleId,
    dayNav,
    await ethers.provider.getBlockNumber(),
    ethers.id("snapshot-random-50.csv")
  );
  const cycleData = await controller.cycles(cycleId);
  console.log(`   • Oracle Updated Cycle #${cycleId}: NAV ${ethers.formatEther(dayNav)} tMMF (${cycleData.diffPercentScaled} scaled diff)`);

  console.log("   🚀 Distributing NAV Growth payouts to all 50 wallets...");
  await controller.connect(distributor).distributeToWallets(
    addrs.slice(0, 25),
    cycleId,
    wallets.slice(0, 25).map((wallet) => wallet.expectedBalance)
  );
  await controller.connect(distributor).distributeToWallets(
    addrs.slice(25, 50),
    cycleId,
    wallets.slice(25, 50).map((wallet) => wallet.expectedBalance)
  );

  // Calculate off-chain expected post-distribution balances
  const PRECISION = 10_000_000_000n;
  for (const w of wallets) {
    const earned = (w.expectedBalance * cycleData.diffPercentScaled) / PRECISION;
    w.expectedBalance += earned;
  }

  // 6. Phase 4: Full Reconciliation Audit across all 50 Wallets
  console.log("\n🔍 Phase 4: Performing Complete 50-Wallet Reconciliation Audit...");
  let mismatchCount = 0;

  for (let i = 0; i < 50; i++) {
    const w = wallets[i];
    const actualBal = await token.balanceOf(w.address);

    if (actualBal !== w.expectedBalance) {
      console.error(`   ❌ MISMATCH on Wallet #${i} (${w.address}): Expected ${w.expectedBalance}, Actual ${actualBal}`);
      mismatchCount++;
    }
  }

  // Live holdings by broker
  let liveInnovestXSum = 0n;
  let liveDimeSum = 0n;
  let liveThirdSum = 0n;

  for (const w of wallets) {
    const bal = await token.balanceOf(w.address);
    if (w.brokerBytes32 === BROKER_INNOVESTX) liveInnovestXSum += bal;
    if (w.brokerBytes32 === BROKER_DIME) liveDimeSum += bal;
    if (w.brokerBytes32 === BROKER_THIRD) liveThirdSum += bal;
  }

  const totalActiveLiveSum = liveInnovestXSum + liveDimeSum + liveThirdSum;
  const totalSharesOnChain = await controller.totalShares();

  console.log("\n=========================================================================");
  console.log("📊 50-WALLET MONTE CARLO AUDIT SUMMARY");
  console.log("=========================================================================");
  console.log(`• Wallet Balances Audit (50/50)      : ${mismatchCount === 0 ? "100% PERFECT MATCH ✅ (0 wei discrepancy)" : `${mismatchCount} MISMATCHES ❌`}`);
  console.log(`• Live InnovestX Wallet Holdings     : ${ethers.formatEther(liveInnovestXSum)} tMMF`);
  console.log(`• Live Dime Wallet Holdings          : ${ethers.formatEther(liveDimeSum)} tMMF`);
  console.log(`• Live ThirdBroker Wallet Holdings   : ${ethers.formatEther(liveThirdSum)} tMMF`);
  console.log(`• Sum of All 50 Live Wallet Holdings : ${ethers.formatEther(totalActiveLiveSum)} tMMF`);
  console.log(`• Controller Total Shares On-Chain   : ${ethers.formatEther(totalSharesOnChain)} tMMF`);
  console.log("=========================================================================\n");

  if (mismatchCount === 0 && totalActiveLiveSum === totalSharesOnChain) {
    console.log("🎉 MONTE CARLO STRESS TEST COMPLETED WITH 100% MATHEMATICAL PRECISION!");
  } else {
    throw new Error("Audit failed with discrepancies!");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
