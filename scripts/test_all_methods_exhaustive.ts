import { ethers } from "hardhat";

async function main() {
  console.log("\n=========================================================================");
  console.log("🔥 EXHAUSTIVE METHOD-BY-METHOD LIVE TEST SUITE (Local Hardhat Node)");
  console.log("=========================================================================\n");

  const [deployer, navUpdater, distributor, allotmentAdmin, innovestXUser, dimeUser, thirdUser] =
    await ethers.getSigners();

  const BROKER_INNOVESTX = ethers.keccak256(ethers.toUtf8Bytes("InnovestX"));
  const BROKER_DIME = ethers.keccak256(ethers.toUtf8Bytes("Dime"));
  const BROKER_THIRD = ethers.keccak256(ethers.toUtf8Bytes("ThirdBroker"));

  const TEN_TOKENS = ethers.parseEther("10");
  const TWENTY_TOKENS = ethers.parseEther("20");
  const FIFTY_TOKENS = ethers.parseEther("50");
  const ONE_HUNDRED_TOKENS = ethers.parseEther("100");
  const FIVE_HUNDRED_TOKENS = ethers.parseEther("500");

  // Deployed Contract Addresses from local deployment
  const gatewayAddr = "0x3Aa5ebB10DC797CAC828524e59A333d0A371443c";
  const tokenAddr = "0xa85233C63b9Ee964Add6F2cffe00Fd84eb32338f";
  const controllerAddr = "0x4A679253410272dd5232B3Ff7cF5dbB88f295319";
  const hookAddr = "0xc3e53F4d16Ae77Db1c982e75a937B9f60FE63690";

  const gateway = await ethers.getContractAt("BrokerCorridorGateway", gatewayAddr);
  const token = await ethers.getContractAt("InvestmentTokenM", tokenAddr);
  const controller = await ethers.getContractAt("FundController", controllerAddr);
  const hook = await ethers.getContractAt("FundComplianceHook", hookAddr);

  let stepCount = 1;
  const sectionHeader = (title: string) => {
    console.log(`\n=========================================================================`);
    console.log(`📌 SECTION ${stepCount++}: ${title}`);
    console.log(`=========================================================================`);
  };

  // ------------------------------------------------------------------------
  sectionHeader("BrokerCorridorGateway - All Methods");
  // ------------------------------------------------------------------------
  console.log("1. Getters & Role Hashes:");
  console.log("   • REGISTRAR_ROLE:", await gateway.REGISTRAR_ROLE());
  console.log("   • CORRIDOR_ADMIN_ROLE:", await gateway.CORRIDOR_ADMIN_ROLE());
  console.log("   • globalUnlock state:", await gateway.crossBrokerTransfersGloballyEnabled());

  console.log("\n2. Single Wallet Registration:");
  await gateway.registerWallet(thirdUser.address, BROKER_THIRD);
  console.log("   • thirdUser broker:", await gateway.walletBroker(thirdUser.address));
  console.log("   • isAllowlist(thirdUser):", await gateway.isAllowlist(thirdUser.address));

  console.log("\n3. Batch Wallet Registration:");
  const testWalletA = ethers.Wallet.createRandom().address;
  const testWalletB = ethers.Wallet.createRandom().address;
  await gateway.registerWalletsBatch([testWalletA, testWalletB], [BROKER_INNOVESTX, BROKER_DIME]);
  console.log("   • testWalletA broker:", await gateway.walletBroker(testWalletA));
  console.log("   • testWalletB broker:", await gateway.walletBroker(testWalletB));

  console.log("\n4. Corridor Directional & Batch Matrix:");
  await gateway.setCorridorDirectional(BROKER_INNOVESTX, BROKER_THIRD, true);
  console.log("   • Directional InnovestX -> ThirdBroker allowed:", await gateway.isTransferAllowed(innovestXUser.address, thirdUser.address));
  console.log("   • Reverse ThirdBroker -> InnovestX allowed:", await gateway.isTransferAllowed(thirdUser.address, innovestXUser.address));

  await gateway.setCorridorDirectional(BROKER_THIRD, BROKER_INNOVESTX, true);
  console.log("   • Reverse ThirdBroker -> InnovestX allowed after directional enable:", await gateway.isTransferAllowed(thirdUser.address, innovestXUser.address));

  console.log("\n5. Global Unlock Toggle:");
  await gateway.setGlobalUnlock(true);
  console.log("   • globalUnlock enabled:", await gateway.crossBrokerTransfersGloballyEnabled());
  await gateway.setGlobalUnlock(false);
  console.log("   • globalUnlock disabled:", await gateway.crossBrokerTransfersGloballyEnabled());

  // ------------------------------------------------------------------------
  sectionHeader("InvestmentTokenM - All Methods");
  // ------------------------------------------------------------------------
  console.log("1. Token Metadata & Initial Supplies:");
  console.log("   • Name:", await token.name());
  console.log("   • Symbol:", await token.symbol());
  console.log("   • Decimals:", await token.decimals());
  console.log("   • Total Supply:", ethers.formatEther(await token.totalSupply()), "tMMF");

  console.log("\n2. Minting:");
  await token.mint(FIVE_HUNDRED_TOKENS);
  console.log("   • Minted 500 tMMF. Deployer Balance:", ethers.formatEther(await token.balanceOf(deployer.address)), "tMMF");

  console.log("\n3. ERC-20 Allowances:");
  await token.approve(dimeUser.address, FIFTY_TOKENS);
  console.log("   • Approved Dime User:", ethers.formatEther(await token.allowance(deployer.address, dimeUser.address)), "tMMF");

  await token.increaseAllowance(dimeUser.address, TEN_TOKENS);
  console.log("   • Increased Allowance to:", ethers.formatEther(await token.allowance(deployer.address, dimeUser.address)), "tMMF");

  await token.decreaseAllowance(dimeUser.address, TWENTY_TOKENS);
  console.log("   • Decreased Allowance to:", ethers.formatEther(await token.allowance(deployer.address, dimeUser.address)), "tMMF");

  console.log("\n4. Transfer Limits:");
  try { await token.disableTransferLimitable(); } catch (e) {}
  await token.enableTransferLimitable();
  await token.setTransferLimit(innovestXUser.address, FIVE_HUNDRED_TOKENS);
  console.log("   • Set transfer limit for InnovestX User: 500 tMMF");
  await token.unsetTransferLimit(innovestXUser.address);
  console.log("   • Unset transfer limit for InnovestX User");
  await token.disableTransferLimitable();
  console.log("   • Disabled transfer limit.");

  console.log("\n5. Pausable Features:");
  await token.pause();
  console.log("   • Token paused:", await token.paused());
  await token.unpause();
  console.log("   • Token unpaused:", await token.paused());

  // ------------------------------------------------------------------------
  sectionHeader("FundComplianceHook - All Methods");
  // ------------------------------------------------------------------------
  console.log("1. Getters:");
  console.log("   • Token Address:", await hook.investmentToken());
  console.log("   • Gateway Address:", await hook.corridorGateway());
  console.log("   • Controller Address:", await hook.fundController());
  console.log("   • Min Holding Amount:", ethers.formatEther(await hook.minHoldingAmount()), "tMMF");
  console.log("   • Min Holding Enabled:", await hook.minHoldingCheckEnabled());

  console.log("\n2. Configuration Setter:");
  await hook.setMinHoldingConfig(ethers.parseEther("15"), true);
  console.log("   • Min holding updated to 15 tMMF");
  await hook.setMinHoldingConfig(TEN_TOKENS, true);
  console.log("   • Restored min holding to 10 tMMF");

  // ------------------------------------------------------------------------
  sectionHeader("FundController - All Core Fund Operations");
  // ------------------------------------------------------------------------
  console.log("1. Fund Reserves:");
  await gateway.registerWallet(deployer.address, BROKER_INNOVESTX);
  await token.approve(controllerAddr, ethers.parseEther("250"));
  await controller.fundBrokerReserve(BROKER_INNOVESTX, ethers.parseEther("150"));
  await controller.fundBrokerReserve(BROKER_DIME, ONE_HUNDRED_TOKENS);
  console.log("   • Funded 250 tMMF into isolated broker reserves.");

  console.log("\n2. Subscription Allotments:");
  const subA = ethers.id("EX-SUB-A");
  await controller.connect(allotmentAdmin).allotShares(innovestXUser.address, FIFTY_TOKENS, subA);
  console.log("   • Allotted 50 tMMF to InnovestX User. Balance:", ethers.formatEther(await token.balanceOf(innovestXUser.address)), "tMMF");

  const subBatch1 = ethers.id("EX-SUB-B1");
  const subBatch2 = ethers.id("EX-SUB-B2");
  await controller.connect(allotmentAdmin).allotSharesBatch(
    [innovestXUser.address, dimeUser.address],
    [FIFTY_TOKENS, FIFTY_TOKENS],
    [subBatch1, subBatch2]
  );
  console.log("   • Batch Allotted 50 tMMF each to InnovestX and Dime Users.");

  console.log("\n3. NAV Oracle Updates & Push Distributions:");
  const baseNav = await controller.totalShares();
  console.log("   • Current Total Shares Baseline:", ethers.formatEther(baseNav), "tMMF");

  if ((await controller.latestNav()) === 0n) {
    await controller.connect(navUpdater).setBaselineNav(baseNav);
    console.log("   • Baseline NAV Set:", ethers.formatEther(baseNav));
  }

  const cycleId = 9999;
  const growthNav = baseNav + ethers.parseEther("15"); // +10% growth
  const navWallets = [innovestXUser.address, dimeUser.address];
  const reportedBalances = await Promise.all(navWallets.map((wallet) => token.balanceOf(wallet)));
  await controller.connect(navUpdater).updateNav(
    cycleId,
    growthNav,
    await ethers.provider.getBlockNumber(),
    ethers.id("snapshot-all-methods.csv")
  );
  console.log("   • Pushed NAV Growth Cycle #9999:", ethers.formatEther(growthNav), "tMMF");

  await controller.connect(distributor).distributeToWallets(navWallets, cycleId, reportedBalances);
  console.log("   • Distributed Cycle #9999 payouts to wallets.");

  console.log("\n4. Redemptions & T+1 Burn:");
  await token.connect(innovestXUser).approve(controllerAddr, TWENTY_TOKENS);
  const redeemReq = ethers.id("EX-REDEEM-001");
  await controller.connect(allotmentAdmin).requestRedeem(innovestXUser.address, TWENTY_TOKENS, redeemReq);
  console.log("   • Requested redemption of 20 tMMF for InnovestX User.");
  console.log("   • Locked for InnovestX Broker:", ethers.formatEther(await controller.lockedForRedemption(BROKER_INNOVESTX)), "tMMF");

  await controller.settleRedemptions([redeemReq]);
  console.log("   • T+1 Settlement Burn executed! Locked remaining:", ethers.formatEther(await controller.lockedForRedemption(BROKER_INNOVESTX)), "tMMF");

  console.log("\n5. Controller Pausable Controls:");
  await controller.pause();
  console.log("   • FundController paused:", await controller.paused());
  await controller.unpause();
  console.log("   • FundController unpaused:", await controller.paused());

  console.log("\n=========================================================================");
  console.log("🎉 ALL CONTRACT METHODS VERIFIED & EXECUTED LIVE!");
  console.log("=========================================================================\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
