import { ethers } from "hardhat";
import { expect } from "chai";

async function main() {
  console.log("\n=========================================================================");
  console.log("🏦 LIVE E2E TEST: INTER-BROKER REBALANCING & SUB-WALLET MIGRATION FLOW");
  console.log("=========================================================================\n");

  const [deployer, scbamAdmin, innovestXMainWallet, innovestXUserA, dimeUserB] = await ethers.getSigners();

  const BROKER_INNOVESTX = ethers.keccak256(ethers.toUtf8Bytes("InnovestX"));
  const BROKER_DIME = ethers.keccak256(ethers.toUtf8Bytes("Dime"));

  // 1. Deploy System
  console.log("1️⃣ Deploying Contracts...");
  const Gateway = await ethers.getContractFactory("BrokerCorridorGateway");
  const gateway = await Gateway.deploy(deployer.address);

  const Token = await ethers.getContractFactory("InvestmentTokenM");
  const token = await Token.deploy("Tokenized Mutual Fund", "tMMF", await gateway.getAddress());

  const Controller = await ethers.getContractFactory("FundController");
  const controller = await Controller.deploy(await token.getAddress(), scbamAdmin.address);
  await controller.connect(scbamAdmin).setBrokerRegistry(await gateway.getAddress());

  const Hook = await ethers.getContractFactory("FundComplianceHook");
  const hook = await Hook.deploy(await token.getAddress(), await gateway.getAddress(), await controller.getAddress());
  await hook.setMinHoldingConfig(ethers.parseEther("10"), true);
  await token.setTransferHook(await hook.getAddress());
  await controller.connect(scbamAdmin).setComplianceHook(await hook.getAddress());

  // Setup Gateway Roles
  const REGISTRAR_ROLE = await gateway.REGISTRAR_ROLE();
  const CORRIDOR_ADMIN_ROLE = await gateway.CORRIDOR_ADMIN_ROLE();
  await gateway.grantRole(REGISTRAR_ROLE, deployer.address);
  await gateway.grantRole(CORRIDOR_ADMIN_ROLE, deployer.address);

  // Register Controller, Broker Main Wallet, and Sub-Wallets
  await gateway.registerWallet(await controller.getAddress(), BROKER_INNOVESTX);
  await gateway.registerWallet(deployer.address, BROKER_INNOVESTX);
  await gateway.registerWallet(innovestXMainWallet.address, BROKER_INNOVESTX);
  await gateway.registerWallet(innovestXUserA.address, BROKER_INNOVESTX);
  await gateway.registerWallet(dimeUserB.address, BROKER_DIME);

  // Setup Controller Roles
  const ALLOTMENT_ROLE = await controller.ALLOTMENT_ROLE();
  await controller.connect(scbamAdmin).grantRole(ALLOTMENT_ROLE, scbamAdmin.address);

  // 2. Initial Setup: SCBAM Mints 1,000 tMMF and funds InnovestX isolated reserve
  console.log("\n2️⃣ Initial Reserve Funding (1,000 tMMF to InnovestX reserve)...");
  await token.mint(ethers.parseEther("1000"));
  await token.approve(await controller.getAddress(), ethers.parseEther("1000"));
  await controller.fundBrokerReserve(BROKER_INNOVESTX, ethers.parseEther("1000"));

  // 3. Allot 100 tMMF to InnovestX Investor Alice
  console.log("3️⃣ Allotting 100 tMMF to InnovestX Investor Alice...");
  await controller.connect(scbamAdmin).allotShares(innovestXUserA.address, ethers.parseEther("100"), ethers.id("SUB-ALICE-01"));

  console.log("   • Alice Balance             :", ethers.formatEther(await token.balanceOf(innovestXUserA.address)), "tMMF");
  console.log("   • InnovestX Active Shares   :", ethers.formatEther(await controller.totalSharesByBroker(BROKER_INNOVESTX)), "tMMF");
  console.log("   • InnovestX Reserve Buffer  :", ethers.formatEther(await controller.brokerReserve(BROKER_INNOVESTX)), "tMMF");
  console.log("   • Dime Active Shares        :", ethers.formatEther(await controller.totalSharesByBroker(BROKER_DIME)), "tMMF");
  console.log("   • Dime Reserve Buffer       :", ethers.formatEther(await controller.brokerReserve(BROKER_DIME)), "tMMF");

  // 4. Investor Alice transfers 100 tMMF to InnovestX Main Wallet (Exit)
  console.log("\n4️⃣ Step 1: Alice transfers 100 tMMF to InnovestX Main Wallet (Same-Broker Transfer)...");
  await token.connect(innovestXUserA).transfer(innovestXMainWallet.address, ethers.parseEther("100"));
  console.log("   • Alice Balance             :", ethers.formatEther(await token.balanceOf(innovestXUserA.address)), "tMMF");
  console.log("   • InnovestX Main Balance    :", ethers.formatEther(await token.balanceOf(innovestXMainWallet.address)), "tMMF");
  console.log("   • InnovestX Active Shares   :", ethers.formatEther(await controller.totalSharesByBroker(BROKER_INNOVESTX)), "tMMF (Still 100 active)");

  // 5. InnovestX Main Wallet deposits 100 tMMF back into Controller Reserve
  console.log("\n5️⃣ Step 2: InnovestX Main deposits 100 tMMF into Controller Reserve (fundBrokerReserve)...");
  await token.connect(innovestXMainWallet).approve(await controller.getAddress(), ethers.parseEther("100"));
  await controller.connect(innovestXMainWallet).fundBrokerReserve(BROKER_INNOVESTX, ethers.parseEther("100"));

  console.log("   • InnovestX Main Balance    :", ethers.formatEther(await token.balanceOf(innovestXMainWallet.address)), "tMMF (0 tMMF)");
  console.log("   • InnovestX Active Shares   :", ethers.formatEther(await controller.totalSharesByBroker(BROKER_INNOVESTX)), "tMMF (0 tMMF)");
  console.log("   • InnovestX Reserve Buffer  :", ethers.formatEther(await controller.brokerReserve(BROKER_INNOVESTX)), "tMMF (1,000 tMMF)");

  // 6. SCBAM Admin rebalances 100 tMMF from InnovestX Reserve to Dime Reserve
  console.log("\n6️⃣ Step 3: SCBAM Admin executes rebalanceBrokerReserve(InnovestX -> Dime, 100 tMMF)...");
  await controller.connect(scbamAdmin).rebalanceBrokerReserve(BROKER_INNOVESTX, BROKER_DIME, ethers.parseEther("100"));

  console.log("   • InnovestX Reserve Buffer  :", ethers.formatEther(await controller.brokerReserve(BROKER_INNOVESTX)), "tMMF (900 tMMF)");
  console.log("   • Dime Reserve Buffer       :", ethers.formatEther(await controller.brokerReserve(BROKER_DIME)), "tMMF (100 tMMF)");

  // 7. Allot 100 tMMF to Dime Investor Bob
  console.log("\n7️⃣ Step 4: Allotting 100 tMMF to Dime Investor Bob...");
  await controller.connect(scbamAdmin).allotShares(dimeUserB.address, ethers.parseEther("100"), ethers.id("SUB-BOB-01"));

  console.log("   • Bob (Dime) Balance        :", ethers.formatEther(await token.balanceOf(dimeUserB.address)), "tMMF (100 tMMF)");
  console.log("   • Dime Active Shares        :", ethers.formatEther(await controller.totalSharesByBroker(BROKER_DIME)), "tMMF (100 tMMF)");
  console.log("   • Dime Reserve Buffer       :", ethers.formatEther(await controller.brokerReserve(BROKER_DIME)), "tMMF (0 tMMF)");
  console.log("   • Total Circulating Shares  :", ethers.formatEther(await controller.totalShares()), "tMMF (100 tMMF)");

  // 8. Mathematical Reconciliation Audit
  const bobBal = await token.balanceOf(dimeUserB.address);
  const dimeActive = await controller.totalSharesByBroker(BROKER_DIME);
  const totalActive = await controller.totalShares();

  if (bobBal === ethers.parseEther("100") && dimeActive === ethers.parseEther("100") && totalActive === ethers.parseEther("100")) {
    console.log("\n=========================================================================");
    console.log("🎉 INTER-BROKER REBALANCING E2E TEST PASSED WITH 100% PRECISION!");
    console.log("=========================================================================\n");
  } else {
    throw new Error("Audit failed!");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
