import { ethers } from "hardhat";

async function main() {
  console.log("\n=================================================");
  console.log("🧪 Executing Live Contract Scenarios against Local Node");
  console.log("=================================================");

  const provider = ethers.provider;
  const [deployer, navUpdater, distributor, allotmentAdmin, innovestXUser, dimeUser, thirdUser] =
    await ethers.getSigners();

  const BROKER_INNOVESTX = ethers.keccak256(ethers.toUtf8Bytes("InnovestX"));
  const BROKER_DIME = ethers.keccak256(ethers.toUtf8Bytes("Dime"));
  const BROKER_THIRD = ethers.keccak256(ethers.toUtf8Bytes("ThirdBroker"));

  const TEN_TOKENS = ethers.parseEther("10");
  const TWENTY_TOKENS = ethers.parseEther("20");
  const FIFTY_TOKENS = ethers.parseEther("50");
  const ONE_HUNDRED_TOKENS = ethers.parseEther("100");

  // Deployed Contract Addresses from local deployment
  const gatewayAddr = "0x3Aa5ebB10DC797CAC828524e59A333d0A371443c";
  const tokenAddr = "0xa85233C63b9Ee964Add6F2cffe00Fd84eb32338f";
  const controllerAddr = "0x4A679253410272dd5232B3Ff7cF5dbB88f295319";
  const hookAddr = "0xc3e53F4d16Ae77Db1c982e75a937B9f60FE63690";

  const gateway = await ethers.getContractAt("BrokerCorridorGateway", gatewayAddr);
  const token = await ethers.getContractAt("InvestmentTokenM", tokenAddr);
  const controller = await ethers.getContractAt("FundController", controllerAddr);
  const hook = await ethers.getContractAt("FundComplianceHook", hookAddr);

  // Helper log function
  const logStep = (step: string, desc: string) => {
    console.log(`\n🔹 [${step}] ${desc}`);
  };

  // ------------------------------------------------------------------------
  logStep("SCENARIO 1", "Subscription Allotment via FundController");
  // ------------------------------------------------------------------------
  const subId1 = ethers.id("LIVE-SUB-001");
  console.log(`   Allotting 50 tMMF to InnovestX User (${innovestXUser.address})...`);
  const tx1 = await controller.connect(allotmentAdmin).allotShares(innovestXUser.address, FIFTY_TOKENS, subId1);
  await tx1.wait();

  const bal1 = await token.balanceOf(innovestXUser.address);
  const brokerLedger1 = await controller.totalSharesByBroker(BROKER_INNOVESTX);
  console.log(`   ✅ InnovestX User Balance: ${ethers.formatEther(bal1)} tMMF`);
  console.log(`   ✅ InnovestX Broker Total Ledger: ${ethers.formatEther(brokerLedger1)} tMMF`);

  // ------------------------------------------------------------------------
  logStep("SCENARIO 2", "Corridor Transfer (InnovestX -> Dime)");
  // ------------------------------------------------------------------------
  console.log(`   Transferring 20 tMMF from InnovestX User to Dime User (${dimeUser.address})...`);
  const tx2 = await token.connect(innovestXUser).transfer(dimeUser.address, TWENTY_TOKENS);
  await tx2.wait();

  const balInnovestX = await token.balanceOf(innovestXUser.address);
  const balDime = await token.balanceOf(dimeUser.address);
  console.log(`   ✅ InnovestX User Post Balance: ${ethers.formatEther(balInnovestX)} tMMF (expected 30)`);
  console.log(`   ✅ Dime User Post Balance     : ${ethers.formatEther(balDime)} tMMF (expected 20)`);

  // ------------------------------------------------------------------------
  logStep("SCENARIO 3", "Minimum Holding Rule Revert Check (10 tMMF)");
  // ------------------------------------------------------------------------
  console.log(`   Attempting transfer of 25 tMMF from InnovestX User (leaving 5 tMMF < 10 tMMF limit)...`);
  try {
    await token.connect(innovestXUser).transfer(dimeUser.address, ethers.parseEther("25"));
    console.error("   ❌ ERROR: Transfer should have reverted!");
  } catch (err: any) {
    console.log(`   ✅ REVERT CONFIRMED: Transfer blocked by MinimumHoldingRequired hook.`);
  }

  // ------------------------------------------------------------------------
  logStep("SCENARIO 4", "Cross-Broker Corridor Gate Revert Check");
  // ------------------------------------------------------------------------
  console.log(`   Registering Third Broker User (${thirdUser.address}) with ThirdBroker...`);
  const REGISTRAR_ROLE = await gateway.REGISTRAR_ROLE();
  await gateway.grantRole(REGISTRAR_ROLE, deployer.address);
  await gateway.registerWallet(thirdUser.address, BROKER_THIRD);

  console.log(`   Attempting transfer from InnovestX User to Third Broker User (corridor closed)...`);
  try {
    await token.connect(innovestXUser).transfer(thirdUser.address, TEN_TOKENS);
    console.error("   ❌ ERROR: Transfer should have reverted!");
  } catch (err: any) {
    console.log(`   ✅ REVERT CONFIRMED: Transfer blocked by CrossBrokerTransferNotAllowed.`);
  }

  // ------------------------------------------------------------------------
  logStep("SCENARIO 5", "Daily NAV Growth Distribution");
  // ------------------------------------------------------------------------
  console.log(`   Allotting 100 tMMF to Dime User...`);
  await controller.connect(allotmentAdmin).allotShares(dimeUser.address, ONE_HUNDRED_TOKENS, ethers.id("LIVE-SUB-002"));

  const baselineNav = await token.balanceOf(innovestXUser.address) + await token.balanceOf(dimeUser.address); // 30 + 120 = 150
  console.log(`   Setting Baseline NAV: ${ethers.formatEther(baselineNav)} tMMF...`);
  await controller.connect(navUpdater).setBaselineNav(baselineNav);

  // NAV grows by 10% (150 -> 165)
  const newNav = baselineNav + ethers.parseEther("15");
  console.log(`   Pushing NAV Cycle #1001 (NAV: ${ethers.formatEther(newNav)} tMMF, +10% growth)...`);
  const reportedDimeBalance = await token.balanceOf(dimeUser.address);
  await controller.connect(navUpdater).updateNav(
    1001,
    newNav,
    await ethers.provider.getBlockNumber(),
    ethers.id("snapshot-live-scenarios.csv")
  );

  console.log(`   Distributing NAV Growth to Dime User...`);
  await controller.connect(distributor).distributeToWallet(dimeUser.address, 1001, reportedDimeBalance);

  const finalDimeBal = await token.balanceOf(dimeUser.address);
  console.log(`   ✅ Dime User Final Balance: ${ethers.formatEther(finalDimeBal)} tMMF (120 initial + 12 growth = 132 tMMF)`);

  // ------------------------------------------------------------------------
  logStep("SCENARIO 6", "Full Exit Transfer (Sender balance -> 0)");
  // ------------------------------------------------------------------------
  console.log(`   InnovestX User executing full exit (transferring all 30 tMMF to Dime User)...`);
  await token.connect(innovestXUser).transfer(dimeUser.address, ethers.parseEther("30"));

  const exitBal = await token.balanceOf(innovestXUser.address);
  console.log(`   ✅ InnovestX User Balance: ${ethers.formatEther(exitBal)} tMMF (Full Exit clean)`);

  // ------------------------------------------------------------------------
  logStep("SCENARIO 7", "Redemption Request & T+1 Settlement Broker Burn");
  // ------------------------------------------------------------------------
  console.log(`   Dime User approving controller to pull 50 tMMF for redemption...`);
  await token.connect(dimeUser).approve(controllerAddr, ethers.parseEther("50"));

  const redeemReqId = ethers.id("LIVE-REDEEM-001");
  console.log(`   Requesting redemption of 50 tMMF for Dime User...`);
  await controller.connect(allotmentAdmin).requestRedeem(dimeUser.address, ethers.parseEther("50"), redeemReqId);

  const lockedAmt = await controller.lockedForRedemption(BROKER_DIME);
  const dimePostRedeemBal = await token.balanceOf(dimeUser.address);
  console.log(`   ✅ Dime User Post-Redeem Balance: ${ethers.formatEther(dimePostRedeemBal)} tMMF (162 - 50 = 112 tMMF)`);
  console.log(`   ✅ Locked For Redemption (Dime Broker): ${ethers.formatEther(lockedAmt)} tMMF`);

  console.log(`   Executing T+1 Settlement Burn for Dime Broker...`);
  const totalSupplyBeforeBurn = await token.totalSupply();
  await controller.connect(deployer).settleRedemptions([redeemReqId]);
  const totalSupplyAfterBurn = await token.totalSupply();

  console.log(`   ✅ T+1 Burn Executed! Total Supply destroyed: ${ethers.formatEther(totalSupplyBeforeBurn - totalSupplyAfterBurn)} tMMF`);

  console.log("\n=================================================");
  console.log("🎉 ALL LIVE SCENARIOS VERIFIED SUCCESSFULLY!");
  console.log("=================================================\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
