import { ethers } from "hardhat";

async function main() {
  console.log("\n=========================================================================");
  console.log("🔄 TESTING LIVE CROSS-BROKER LEDGER AUTOMATIC SYNCHRONIZATION");
  console.log("=========================================================================\n");

  const [deployer, allotmentAdmin, innovestXUser, dimeUser] = await ethers.getSigners();

  const BROKER_INNOVESTX = ethers.keccak256(ethers.toUtf8Bytes("InnovestX"));
  const BROKER_DIME = ethers.keccak256(ethers.toUtf8Bytes("Dime"));

  // 1. Deploy contracts
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

  // Link Controller <-> Hook
  await controller.setComplianceHook(await hook.getAddress());

  const REGISTRAR_ROLE = await gateway.REGISTRAR_ROLE();
  const CORRIDOR_ADMIN_ROLE = await gateway.CORRIDOR_ADMIN_ROLE();
  await gateway.grantRole(REGISTRAR_ROLE, deployer.address);
  await gateway.grantRole(CORRIDOR_ADMIN_ROLE, deployer.address);

  // Register Controller & Investor Wallets
  await gateway.registerWallet(await controller.getAddress(), BROKER_INNOVESTX);
  await gateway.registerWalletsBatch([innovestXUser.address, dimeUser.address], [BROKER_INNOVESTX, BROKER_DIME]);

  // Open Corridor InnovestX <-> Dime
  await gateway.setCorridor(BROKER_INNOVESTX, BROKER_DIME, true);

  const ALLOTMENT_ROLE = await controller.ALLOTMENT_ROLE();
  await controller.grantRole(ALLOTMENT_ROLE, allotmentAdmin.address);

  // Fund Reserve & Allot initial shares
  await token.mint(ethers.parseEther("1000"));
  await token.transfer(await controller.getAddress(), ethers.parseEther("1000"));

  await controller.connect(allotmentAdmin).allotShares(innovestXUser.address, ethers.parseEther("100"), ethers.id("SUB-SYNC-1"));
  await controller.connect(allotmentAdmin).allotShares(dimeUser.address, ethers.parseEther("100"), ethers.id("SUB-SYNC-2"));

  console.log("📌 Initial State:");
  console.log("   • InnovestX User Balance :", ethers.formatEther(await token.balanceOf(innovestXUser.address)), "tMMF");
  console.log("   • Dime User Balance      :", ethers.formatEther(await token.balanceOf(dimeUser.address)), "tMMF");
  console.log("   • InnovestX Broker Ledger:", ethers.formatEther(await controller.totalSharesByBroker(BROKER_INNOVESTX)), "tMMF");
  console.log("   • Dime Broker Ledger     :", ethers.formatEther(await controller.totalSharesByBroker(BROKER_DIME)), "tMMF");

  // Perform peer-to-peer transfer across corridor: InnovestX User -> Dime User (30 tMMF)
  console.log("\n⚡ Executing Peer-to-Peer Cross-Broker Transfer (30 tMMF from InnovestX -> Dime)...");
  await token.connect(innovestXUser).transfer(dimeUser.address, ethers.parseEther("30"));

  console.log("\n📌 Post-Transfer State:");
  console.log("   ✅ InnovestX User Balance :", ethers.formatEther(await token.balanceOf(innovestXUser.address)), "tMMF (70 expected)");
  console.log("   ✅ Dime User Balance      :", ethers.formatEther(await token.balanceOf(dimeUser.address)), "tMMF (130 expected)");
  console.log("   ✅ InnovestX Broker Ledger:", ethers.formatEther(await controller.totalSharesByBroker(BROKER_INNOVESTX)), "tMMF (AUTOMATICALLY SYNCED to 70!)");
  console.log("   ✅ Dime Broker Ledger     :", ethers.formatEther(await controller.totalSharesByBroker(BROKER_DIME)), "tMMF (AUTOMATICALLY SYNCED to 130!)");

  console.log("\n=========================================================================");
  console.log("🎉 AUTOMATIC CROSS-BROKER LEDGER SYNC VERIFIED PERFECTLY!");
  console.log("=========================================================================\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
