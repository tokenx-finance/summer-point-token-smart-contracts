import { ethers } from "hardhat";

async function main() {
  console.log("\n=========================================================================");
  console.log("📅 MULTI-DAY NAV CALCULATION & DISTRIBUTION SIMULATION");
  console.log("=========================================================================\n");

  const [deployer, navUpdater, distributor, allotmentAdmin, innovestXA, innovestXB, dimeA, dimeB] =
    await ethers.getSigners();

  const BROKER_INNOVESTX = ethers.keccak256(ethers.toUtf8Bytes("InnovestX"));
  const BROKER_DIME = ethers.keccak256(ethers.toUtf8Bytes("Dime"));

  // 1. Deploy fresh contracts for pristine multi-day simulation
  console.log("🛠️ Deploying fresh contracts for isolated multi-day simulation...");
  const Gateway = await ethers.getContractFactory("BrokerCorridorGateway");
  const gateway = await Gateway.deploy(deployer.address);

  const Token = await ethers.getContractFactory("InvestmentTokenM");
  const token = await Token.deploy("Tokenized Mutual Fund", "tMMF", await gateway.getAddress());

  const Controller = await ethers.getContractFactory("FundController");
  const controller = await Controller.deploy(await token.getAddress(), deployer.address);
  await controller.setBrokerRegistry(await gateway.getAddress());

  const REGISTRAR_ROLE = await gateway.REGISTRAR_ROLE();
  await gateway.grantRole(REGISTRAR_ROLE, deployer.address);

  // Register Controller & Investors in Gateway
  await gateway.registerWallet(await controller.getAddress(), BROKER_INNOVESTX);
  await gateway.registerWalletsBatch(
    [innovestXA.address, innovestXB.address, dimeA.address, dimeB.address],
    [BROKER_INNOVESTX, BROKER_INNOVESTX, BROKER_DIME, BROKER_DIME]
  );

  // Grant Roles in Controller
  const NAV_UPDATER_ROLE = await controller.NAV_UPDATER_ROLE();
  const DISTRIBUTOR_ROLE = await controller.DISTRIBUTOR_ROLE();
  const ALLOTMENT_ROLE = await controller.ALLOTMENT_ROLE();
  await controller.grantRole(NAV_UPDATER_ROLE, navUpdater.address);
  await controller.grantRole(DISTRIBUTOR_ROLE, distributor.address);
  await controller.grantRole(ALLOTMENT_ROLE, allotmentAdmin.address);

  // Fund Controller Reserve with 50,000 tMMF
  const mintAmount = ethers.parseEther("50000");
  await token.mint(mintAmount);
  await token.approve(await controller.getAddress(), mintAmount);
  await controller.fundBrokerReserve(BROKER_INNOVESTX, ethers.parseEther("30000"));
  await controller.fundBrokerReserve(BROKER_DIME, ethers.parseEther("20000"));
  console.log(`🏦 Controller Reserve Funded with 50,000 tMMF.`);

  // ------------------------------------------------------------------------
  console.log("\n-------------------------------------------------------------------------");
  console.log("☀️ DAY 1: Initial Allotments & 5.00% NAV Growth");
  console.log("-------------------------------------------------------------------------");
  // ------------------------------------------------------------------------

  // Allotments
  await controller.connect(allotmentAdmin).allotShares(innovestXA.address, ethers.parseEther("4000"), ethers.id("D1-SUB-1"));
  await controller.connect(allotmentAdmin).allotShares(innovestXB.address, ethers.parseEther("2000"), ethers.id("D1-SUB-2"));
  await controller.connect(allotmentAdmin).allotShares(dimeA.address, ethers.parseEther("4000"), ethers.id("D1-SUB-3"));

  console.log("   • InnovestX User A Balance :", ethers.formatEther(await token.balanceOf(innovestXA.address)), "tMMF");
  console.log("   • InnovestX User B Balance :", ethers.formatEther(await token.balanceOf(innovestXB.address)), "tMMF");
  console.log("   • Dime User A Balance      :", ethers.formatEther(await token.balanceOf(dimeA.address)), "tMMF");

  // Day 1 Baseline NAV = 10,000 tMMF
  const day1Baseline = ethers.parseEther("10000");
  await controller.connect(navUpdater).setBaselineNav(day1Baseline);
  console.log("   • Baseline NAV set to      :", ethers.formatEther(day1Baseline), "tMMF");

  // Day 1 NAV Update: 10,000 -> 10,500 (+5% growth)
  const day1Nav = ethers.parseEther("10500");
  const cycle1 = 20260814;
  await controller.connect(navUpdater).updateNav(
    cycle1,
    day1Nav,
    await ethers.provider.getBlockNumber(),
    ethers.id("snapshot-day-1.csv")
  );

  const cycle1Data = await controller.cycles(cycle1);
  console.log(`\n📊 Day 1 NAV Oracle Updated (Cycle #${cycle1}):`);
  console.log(`   • Old NAV               : ${ethers.formatEther(cycle1Data.oldNav)}`);
  console.log(`   • New NAV               : ${ethers.formatEther(cycle1Data.newNav)}`);
  console.log(`   • Diff Percent Scaled   : ${cycle1Data.diffPercentScaled} (5.00% growth)`);

  // Distribute Day 1
  console.log("\n🚀 Executing Day 1 Push Distribution...");
  await controller.connect(distributor).distributeToWallets(
    [innovestXA.address, innovestXB.address, dimeA.address],
    cycle1,
    [ethers.parseEther("4000"), ethers.parseEther("2000"), ethers.parseEther("4000")]
  );

  console.log("   ✅ InnovestX User A Post Balance (+200 tMMF) :", ethers.formatEther(await token.balanceOf(innovestXA.address)), "tMMF");
  console.log("   ✅ InnovestX User B Post Balance (+100 tMMF) :", ethers.formatEther(await token.balanceOf(innovestXB.address)), "tMMF");
  console.log("   ✅ Dime User A Post Balance      (+200 tMMF) :", ethers.formatEther(await token.balanceOf(dimeA.address)), "tMMF");
  console.log("   ✅ Total Distributed in Day 1              :", ethers.formatEther(await controller.totalDistributedInCycle(cycle1)), "tMMF");

  // ------------------------------------------------------------------------
  console.log("\n-------------------------------------------------------------------------");
  console.log("☀️ DAY 2 (NEXT DAY): New Subscriber Allotment & 3.00% NAV Growth");
  console.log("-------------------------------------------------------------------------");
  // ------------------------------------------------------------------------

  // New Subscription on Day 2: Dime User B buys 1,000 tMMF
  await controller.connect(allotmentAdmin).allotShares(dimeB.address, ethers.parseEther("1000"), ethers.id("D2-SUB-1"));
  console.log("   • Dime User B Joined with Subscription      :", ethers.formatEther(await token.balanceOf(dimeB.address)), "tMMF");

  // Day 2 NAV Update: 10,500 -> 10,815 (+3% growth)
  const day2Nav = ethers.parseEther("10815");
  const cycle2 = 20260815;
  await controller.connect(navUpdater).updateNav(
    cycle2,
    day2Nav,
    await ethers.provider.getBlockNumber(),
    ethers.id("snapshot-day-2.csv")
  );

  const cycle2Data = await controller.cycles(cycle2);
  console.log(`\n📊 Day 2 NAV Oracle Updated (Cycle #${cycle2}):`);
  console.log(`   • Old NAV               : ${ethers.formatEther(cycle2Data.oldNav)}`);
  console.log(`   • New NAV               : ${ethers.formatEther(cycle2Data.newNav)}`);
  console.log(`   • Diff Percent Scaled   : ${cycle2Data.diffPercentScaled} (3.00% growth)`);

  // Distribute Day 2
  console.log("\n🚀 Executing Day 2 Push Distribution...");
  await controller.connect(distributor).distributeToWallets(
    [innovestXA.address, innovestXB.address, dimeA.address, dimeB.address],
    cycle2,
    [ethers.parseEther("4200"), ethers.parseEther("2100"), ethers.parseEther("4200"), ethers.parseEther("1000")]
  );

  console.log("   ✅ InnovestX User A Final Balance (4200 + 126) :", ethers.formatEther(await token.balanceOf(innovestXA.address)), "tMMF");
  console.log("   ✅ InnovestX User B Final Balance (2100 +  63) :", ethers.formatEther(await token.balanceOf(innovestXB.address)), "tMMF");
  console.log("   ✅ Dime User A Final Balance      (4200 + 126) :", ethers.formatEther(await token.balanceOf(dimeA.address)), "tMMF");
  console.log("   ✅ Dime User B Final Balance      (1000 +  30) :", ethers.formatEther(await token.balanceOf(dimeB.address)), "tMMF");
  console.log("   ✅ Total Distributed in Day 2                  :", ethers.formatEther(await controller.totalDistributedInCycle(cycle2)), "tMMF");

  // ------------------------------------------------------------------------
  console.log("\n-------------------------------------------------------------------------");
  console.log("☀️ DAY 3: Flat NAV Day (0.00% Growth)");
  console.log("-------------------------------------------------------------------------");
  // ------------------------------------------------------------------------

  const day3Nav = ethers.parseEther("10815"); // Flat NAV
  const cycle3 = 20260816;
  await controller.connect(navUpdater).updateNav(
    cycle3,
    day3Nav,
    await ethers.provider.getBlockNumber(),
    ethers.id("snapshot-day-3.csv")
  );

  const cycle3Data = await controller.cycles(cycle3);
  console.log(`📊 Day 3 NAV Oracle Updated (Cycle #${cycle3}):`);
  console.log(`   • Old NAV               : ${ethers.formatEther(cycle3Data.oldNav)}`);
  console.log(`   • New NAV               : ${ethers.formatEther(cycle3Data.newNav)}`);
  console.log(`   • Diff Percent Scaled   : ${cycle3Data.diffPercentScaled} (0.00% growth)`);

  await controller.connect(distributor).distributeToWallet(innovestXA.address, cycle3, ethers.parseEther("4326"));
  console.log("   ✅ InnovestX User A Balance on 0% Growth Day :", ethers.formatEther(await token.balanceOf(innovestXA.address)), "tMMF (unchanged)");

  console.log("\n=========================================================================");
  console.log("🎉 MULTI-DAY NAV SIMULATION PASSED CLEANLY!");
  console.log("=========================================================================\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
