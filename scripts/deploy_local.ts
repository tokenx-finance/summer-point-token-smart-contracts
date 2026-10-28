import { ethers } from "hardhat";

async function main() {
  console.log("=================================================");
  console.log("🚀 Starting Local Deployment to Hardhat Node...");
  console.log("=================================================");

  const [deployer, navUpdater, distributor, allotmentAdmin, innovestXUser, dimeUser] =
    await ethers.getSigners();

  console.log(`\n📌 Deployer Account: ${deployer.address}`);
  console.log(`📌 NAV Updater Account: ${navUpdater.address}`);
  console.log(`📌 Distributor Account: ${distributor.address}`);
  console.log(`📌 Allotment Admin Account: ${allotmentAdmin.address}`);

  const BROKER_INNOVESTX = ethers.keccak256(ethers.toUtf8Bytes("InnovestX"));
  const BROKER_DIME = ethers.keccak256(ethers.toUtf8Bytes("Dime"));
  const TEN_TOKENS = ethers.parseEther("10");
  const ONE_THOUSAND_TOKENS = ethers.parseEther("1000");

  // 1. Deploy BrokerCorridorGateway
  console.log("\n1️⃣ Deploying BrokerCorridorGateway...");
  const Gateway = await ethers.getContractFactory("BrokerCorridorGateway");
  const gateway = await Gateway.deploy(deployer.address);
  await gateway.waitForDeployment();
  const gatewayAddr = await gateway.getAddress();
  console.log(`   ✅ BrokerCorridorGateway deployed at: ${gatewayAddr}`);

  // Grant REGISTRAR_ROLE and CORRIDOR_ADMIN_ROLE
  const REGISTRAR_ROLE = await gateway.REGISTRAR_ROLE();
  const CORRIDOR_ADMIN_ROLE = await gateway.CORRIDOR_ADMIN_ROLE();
  await gateway.grantRole(REGISTRAR_ROLE, deployer.address);
  await gateway.grantRole(CORRIDOR_ADMIN_ROLE, deployer.address);

  // Register test user wallets
  await gateway.registerWalletsBatch(
    [innovestXUser.address, dimeUser.address],
    [BROKER_INNOVESTX, BROKER_DIME]
  );
  console.log(`   Registered ${innovestXUser.address} -> InnovestX`);
  console.log(`   Registered ${dimeUser.address} -> Dime`);

  // Open Corridor InnovestX <-> Dime
  await gateway.setCorridor(BROKER_INNOVESTX, BROKER_DIME, true);
  console.log(`   Opened Corridor: InnovestX <-> Dime`);

  // 2. Deploy InvestmentTokenM
  console.log("\n2️⃣ Deploying InvestmentTokenM...");
  const Token = await ethers.getContractFactory("InvestmentTokenM");
  const token = await Token.deploy("Tokenized Mutual Fund", "tMMF", gatewayAddr);
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log(`   ✅ InvestmentTokenM deployed at: ${tokenAddr}`);

  // 3. Deploy FundController
  console.log("\n3️⃣ Deploying FundController...");
  const Controller = await ethers.getContractFactory("FundController");
  const controller = await Controller.deploy(tokenAddr, deployer.address);
  await controller.waitForDeployment();
  const controllerAddr = await controller.getAddress();
  console.log(`   ✅ FundController deployed at: ${controllerAddr}`);

  // Wire Gateway & Roles to FundController
  await controller.setBrokerRegistry(gatewayAddr);
  await gateway.registerWallet(controllerAddr, BROKER_INNOVESTX);

  const NAV_UPDATER_ROLE = await controller.NAV_UPDATER_ROLE();
  const DISTRIBUTOR_ROLE = await controller.DISTRIBUTOR_ROLE();
  const ALLOTMENT_ROLE = await controller.ALLOTMENT_ROLE();
  await controller.grantRole(NAV_UPDATER_ROLE, navUpdater.address);
  await controller.grantRole(DISTRIBUTOR_ROLE, distributor.address);
  await controller.grantRole(ALLOTMENT_ROLE, allotmentAdmin.address);

  // 4. Deploy FundComplianceHook
  console.log("\n4️⃣ Deploying FundComplianceHook...");
  const Hook = await ethers.getContractFactory("FundComplianceHook");
  const hook = await Hook.deploy(tokenAddr, gatewayAddr, controllerAddr);
  await hook.waitForDeployment();
  const hookAddr = await hook.getAddress();
  console.log(`   ✅ FundComplianceHook deployed at: ${hookAddr}`);

  // Configure 10 tMMF min holding & attach hook to token
  await hook.setMinHoldingConfig(TEN_TOKENS, true);
  await token.setTransferHook(hookAddr);
  console.log(`   Connected Transfer Hook to InvestmentTokenM`);

  // 5. Initial Mint & Reserve Funding
  console.log("\n5️⃣ Initial Minting & Funding Controller Reserve...");
  await token.mint(ONE_THOUSAND_TOKENS);
  await token.transfer(controllerAddr, ONE_THOUSAND_TOKENS);
  console.log(`   Minted 1,000 tMMF & funded FundController reserve.`);

  console.log("\n=================================================");
  console.log("🎉 Local Deployment Completed Successfully!");
  console.log("=================================================");
  console.log("Summary of Deployed Contracts:");
  console.log(`• BrokerCorridorGateway : ${gatewayAddr}`);
  console.log(`• InvestmentTokenM      : ${tokenAddr}`);
  console.log(`• FundController        : ${controllerAddr}`);
  console.log(`• FundComplianceHook    : ${hookAddr}`);
  console.log("=================================================\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
