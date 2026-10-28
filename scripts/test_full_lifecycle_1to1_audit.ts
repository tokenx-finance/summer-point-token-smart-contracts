import { ethers } from "hardhat";
import { expect } from "chai";

async function main() {
  console.log("\n=========================================================================");
  console.log("🔥 EXHAUSTIVE 1:1 LEDGER AUDIT: FULL LIFECYCLE E2E TEST");
  console.log("   [Mint -> Reserve -> Allot -> NAV Distribution -> Redeem -> T+1 Burn]");
  console.log("=========================================================================\n");

  const [deployer, scbamAdmin, innovestXUserA, dimeUserB, thirdUserC] = await ethers.getSigners();

  const BROKER_INNOVESTX = ethers.keccak256(ethers.toUtf8Bytes("InnovestX"));
  const BROKER_DIME = ethers.keccak256(ethers.toUtf8Bytes("Dime"));
  const BROKER_THIRD = ethers.keccak256(ethers.toUtf8Bytes("ThirdBroker"));

  // 1. Deploy System Contracts
  console.log("1️⃣ Deploying Smart Contract System...");
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

  // Register Controller & Wallets
  await gateway.registerWallet(await controller.getAddress(), BROKER_INNOVESTX);
  await gateway.registerWallet(deployer.address, BROKER_INNOVESTX);
  await gateway.registerWallet(innovestXUserA.address, BROKER_INNOVESTX);
  await gateway.registerWallet(dimeUserB.address, BROKER_DIME);
  await gateway.registerWallet(thirdUserC.address, BROKER_THIRD);

  // Open Corridor InnovestX <-> Dime
  await gateway.setCorridor(BROKER_INNOVESTX, BROKER_DIME, true);

  // Setup Controller Roles
  const ALLOTMENT_ROLE = await controller.ALLOTMENT_ROLE();
  const NAV_UPDATER_ROLE = await controller.NAV_UPDATER_ROLE();
  const DISTRIBUTOR_ROLE = await controller.DISTRIBUTOR_ROLE();
  await controller.connect(scbamAdmin).grantRole(ALLOTMENT_ROLE, scbamAdmin.address);
  await controller.connect(scbamAdmin).grantRole(NAV_UPDATER_ROLE, scbamAdmin.address);
  await controller.connect(scbamAdmin).grantRole(DISTRIBUTOR_ROLE, scbamAdmin.address);

  // HELPER: Audit 1:1 Invariant Check
  async function audit1to1(stageName: string) {
    const totalSupply = await token.totalSupply();
    const activeTotalShares = await controller.totalShares();
    const controllerTokenBalance = await token.balanceOf(await controller.getAddress());

    const innovestXActive = await controller.totalSharesByBroker(BROKER_INNOVESTX);
    const dimeActive = await controller.totalSharesByBroker(BROKER_DIME);
    const thirdActive = await controller.totalSharesByBroker(BROKER_THIRD);
    const sumBrokerActive = innovestXActive + dimeActive + thirdActive;

    const innovestXReserve = await controller.brokerReserve(BROKER_INNOVESTX);
    const dimeReserve = await controller.brokerReserve(BROKER_DIME);
    const thirdReserve = await controller.brokerReserve(BROKER_THIRD);
    const sumBrokerReserve = innovestXReserve + dimeReserve + thirdReserve;

    const innovestXLocked = await controller.lockedForRedemption(BROKER_INNOVESTX);
    const dimeLocked = await controller.lockedForRedemption(BROKER_DIME);
    const thirdLocked = await controller.lockedForRedemption(BROKER_THIRD);
    const sumLocked = innovestXLocked + dimeLocked + thirdLocked;

    const aliceBal = await token.balanceOf(innovestXUserA.address);
    const bobBal = await token.balanceOf(dimeUserB.address);
    const charlieBal = await token.balanceOf(thirdUserC.address);
    const deployerBal = await token.balanceOf(deployer.address);
    const sumWallets = aliceBal + bobBal + charlieBal;

    console.log(`\n🔍 [AUDIT @ ${stageName}]`);
    console.log(`   • Total Supply              : ${ethers.formatEther(totalSupply)} tMMF`);
    console.log(`   • Controller Balance (Vault): ${ethers.formatEther(controllerTokenBalance)} tMMF`);
    console.log(`   • Active Circulating Shares : ${ethers.formatEther(activeTotalShares)} tMMF`);
    console.log(`   • Sum of Wallet Balances    : ${ethers.formatEther(sumWallets)} tMMF`);
    console.log(`   • Sum of Broker Active      : ${ethers.formatEther(sumBrokerActive)} tMMF`);
    console.log(`   • Sum of Broker Reserves    : ${ethers.formatEther(sumBrokerReserve)} tMMF`);
    console.log(`   • Sum of Locked Redemptions : ${ethers.formatEther(sumLocked)} tMMF`);

    // Invariant 1: Total Supply == Active Shares + Controller Vault Balance + Deployer un-deposited balance
    expect(totalSupply).to.equal(activeTotalShares + controllerTokenBalance + deployerBal, "Invariant 1 Failed: totalSupply != active + vault + deployer");
    // Invariant 2: Active Shares == Sum of Live Wallet Balances
    expect(activeTotalShares).to.equal(sumWallets, "Invariant 2 Failed: activeTotalShares != sum of wallets");
    // Invariant 3: Active Shares == Sum of Broker Active Ledgers
    expect(activeTotalShares).to.equal(sumBrokerActive, "Invariant 3 Failed: activeTotalShares != sum of broker active ledgers");
    // Invariant 4: Controller Vault Balance >= Sum of Broker Reserves + Sum of Locked Redemptions
    expect(controllerTokenBalance).to.be.gte(sumBrokerReserve + sumLocked, "Invariant 4 Failed: Vault balance < reserves + locked");

    console.log(`   ✅ 1:1 LEDGER INVARIANT PERFECTLY MAINTAINED!`);
  }

  // STAGE 1: Mint Initial 10,000 tMMF
  console.log("\n=========================================================================");
  console.log("STAGE 1: Minting 10,000 tMMF tokens to deployer...");
  await token.mint(ethers.parseEther("10000"));
  await audit1to1("Stage 1: After Mint (10,000 in deployer)");

  // STAGE 2: Fund Isolated Reserves on FundController
  console.log("\n=========================================================================");
  console.log("STAGE 2: Depositing 5,000 to InnovestX reserve, 3,000 to Dime reserve, 2,000 to ThirdBroker reserve...");
  await token.approve(await controller.getAddress(), ethers.parseEther("10000"));
  await controller.fundBrokerReserve(BROKER_INNOVESTX, ethers.parseEther("5000"));
  await controller.fundBrokerReserve(BROKER_DIME, ethers.parseEther("3000"));
  await controller.fundBrokerReserve(BROKER_THIRD, ethers.parseEther("2000"));
  await audit1to1("Stage 2: After Reserve Funding (Vault = 10,000, Active = 0)");

  // STAGE 3: Allot Shares to Investors
  console.log("\n=========================================================================");
  console.log("STAGE 3: Allotting shares: Alice (InnovestX) = 500 tMMF, Bob (Dime) = 300 tMMF, Charlie (Third) = 200 tMMF...");
  await controller.connect(scbamAdmin).allotShares(innovestXUserA.address, ethers.parseEther("500"), ethers.id("SUB-A1"));
  await controller.connect(scbamAdmin).allotShares(dimeUserB.address, ethers.parseEther("300"), ethers.id("SUB-B1"));
  await controller.connect(scbamAdmin).allotShares(thirdUserC.address, ethers.parseEther("200"), ethers.id("SUB-C1"));
  await audit1to1("Stage 3: After Allotments (Active = 1,000, Vault = 9,000)");

  // STAGE 4: Peer-to-Peer Cross-Broker Transfer (Alice -> Bob: 100 tMMF)
  console.log("\n=========================================================================");
  console.log("STAGE 4: Cross-Broker Transfer: Alice (InnovestX) transfers 100 tMMF to Bob (Dime)...");
  await token.connect(innovestXUserA).transfer(dimeUserB.address, ethers.parseEther("100"));
  await audit1to1("Stage 4: After Cross-Broker Transfer (Alice=400, Bob=400, Auto-Synced)");

  // STAGE 5: Daily NAV Growth Oracle Push & Distribution (+5.00%)
  console.log("\n=========================================================================");
  console.log("STAGE 5: Pushing Daily NAV Growth (+5.00%) for 1,000 active shares...");
  await controller.connect(scbamAdmin).setBaselineNav(ethers.parseEther("1000"));
  await controller.connect(scbamAdmin).updateNav(
    1,
    ethers.parseEther("1050"),
    await ethers.provider.getBlockNumber(),
    ethers.id("snapshot-lifecycle.csv")
  ); // +5%
  await controller.connect(scbamAdmin).distributeToWallets(
    [innovestXUserA.address, dimeUserB.address, thirdUserC.address],
    1,
    [ethers.parseEther("400"), ethers.parseEther("400"), ethers.parseEther("200")]
  );
  await audit1to1("Stage 5: After NAV Payout (Alice=420, Bob=420, Charlie=210, Active=1,050)");

  // STAGE 6: Redemption Request (Day T: Bob requests redemption of 120 tMMF)
  console.log("\n=========================================================================");
  console.log("STAGE 6: Redemption Request: Bob (Dime) requests redemption of 120 tMMF...");
  await token.connect(dimeUserB).approve(await controller.getAddress(), ethers.parseEther("120"));
  await controller.connect(scbamAdmin).requestRedeem(dimeUserB.address, ethers.parseEther("120"), ethers.id("RED-BOB-01"));
  await audit1to1("Stage 6: After Day T Redemption Lock (Bob=300, Locked=120, Active=930)");

  // STAGE 7: T+1 Settlement Burn (SCBAM Admin settles locked 120 tMMF)
  console.log("\n=========================================================================");
  console.log("STAGE 7: T+1 Settlement: SCBAM Admin executes settleRedemptions([RED-BOB-01])...");
  await controller.connect(scbamAdmin).settleRedemptions([ethers.id("RED-BOB-01")]);
  await audit1to1("Stage 7: After T+1 Burn (Total Supply=9,880, Locked=0, Active=930)");

  console.log("\n=========================================================================");
  console.log("🎉 ALL SCENARIOS VERIFIED 100% 1:1 WITH ON-CHAIN LEDGER RECONCILIATION!");
  console.log("=========================================================================\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
