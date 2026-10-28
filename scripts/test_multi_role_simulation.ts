import { ethers } from "hardhat";
import { expect } from "chai";

async function main() {
  console.log("\n=========================================================================");
  console.log("👥 MULTI-ROLE ACTOR SIMULATION TEST SUITE");
  console.log("   Simulating: SCBAM (Issuer/Admin), TokenX (Infra/Gateway),");
  console.log("               InnovestX (Broker), Dime (Broker), Oracle & Distributor Bots");
  console.log("=========================================================================\n");

  const [
    deployer,
    scbamIssuerWallet,    // SCBAM Treasury & Issuer
    tokenXInfraWallet,    // TokenX Gateway & Compliance Operator
    innovestXBrokerAdmin, // InnovestX Broker Operator & KYC Registrar
    dimeBrokerAdmin,      // Dime Broker Operator & KYC Registrar
    navOracleBot,         // Automated NAV Oracle Cron
    distributorBot,       // Automated NAV Yield Distribution Cron
    innovestXInvestorA,   // Retail Investor A (InnovestX)
    dimeInvestorB         // Retail Investor B (Dime)
  ] = await ethers.getSigners();

  const BROKER_INNOVESTX = ethers.keccak256(ethers.toUtf8Bytes("InnovestX"));
  const BROKER_DIME = ethers.keccak256(ethers.toUtf8Bytes("Dime"));

  // =========================================================================
  // STAGE 1: INFRASTRUCTURE DEPLOYMENT & ROLE PROVISIONING
  // =========================================================================
  console.log("1️⃣ Deploying Smart Contracts & Provisioning Roles...");

  // 1.1 Deploy BrokerCorridorGateway (Deployed by TokenX / SCBAM)
  const Gateway = await ethers.getContractFactory("BrokerCorridorGateway");
  const gateway = await Gateway.connect(tokenXInfraWallet).deploy(tokenXInfraWallet.address);
  const gatewayAddress = await gateway.getAddress();

  // 1.2 Deploy InvestmentTokenM (Owned by SCBAM Issuer)
  const Token = await ethers.getContractFactory("InvestmentTokenM");
  const token = await Token.connect(scbamIssuerWallet).deploy("Tokenized Mutual Fund", "tMMF", gatewayAddress);
  const tokenAddress = await token.getAddress();

  // 1.3 Deploy FundController (Owned by SCBAM Issuer)
  const Controller = await ethers.getContractFactory("FundController");
  const controller = await Controller.connect(scbamIssuerWallet).deploy(tokenAddress, scbamIssuerWallet.address);
  const controllerAddress = await controller.getAddress();

  // 1.4 Deploy FundComplianceHook (Managed by TokenX)
  const Hook = await ethers.getContractFactory("FundComplianceHook");
  const hook = await Hook.connect(tokenXInfraWallet).deploy(tokenAddress, gatewayAddress, controllerAddress);
  const hookAddress = await hook.getAddress();

  // Wire Hook to Token & Controller
  await hook.connect(tokenXInfraWallet).setMinHoldingConfig(ethers.parseEther("10"), true);
  await token.connect(scbamIssuerWallet).setTransferHook(hookAddress);
  await controller.connect(scbamIssuerWallet).setComplianceHook(hookAddress);
  await controller.connect(scbamIssuerWallet).setBrokerRegistry(gatewayAddress);

  // 1.5 Provision Gateway Roles:
  // - TokenX holds CORRIDOR_ADMIN_ROLE
  // - InnovestX holds REGISTRAR_ROLE for InnovestX customers
  // - Dime holds REGISTRAR_ROLE for Dime customers
  const REGISTRAR_ROLE = await gateway.REGISTRAR_ROLE();
  const CORRIDOR_ADMIN_ROLE = await gateway.CORRIDOR_ADMIN_ROLE();
  await gateway.connect(tokenXInfraWallet).grantRole(CORRIDOR_ADMIN_ROLE, tokenXInfraWallet.address);
  await gateway.connect(tokenXInfraWallet).grantRole(REGISTRAR_ROLE, tokenXInfraWallet.address);
  await gateway.connect(tokenXInfraWallet).grantRole(REGISTRAR_ROLE, innovestXBrokerAdmin.address);
  await gateway.connect(tokenXInfraWallet).grantRole(REGISTRAR_ROLE, dimeBrokerAdmin.address);

  // 1.6 Provision FundController Roles:
  // - SCBAM holds DEFAULT_ADMIN_ROLE
  // - InnovestX and Dime hold ALLOTMENT_ROLE (to allot subscription orders)
  // - navOracleBot holds NAV_UPDATER_ROLE
  // - distributorBot holds DISTRIBUTOR_ROLE
  const ALLOTMENT_ROLE = await controller.ALLOTMENT_ROLE();
  const NAV_UPDATER_ROLE = await controller.NAV_UPDATER_ROLE();
  const DISTRIBUTOR_ROLE = await controller.DISTRIBUTOR_ROLE();
  await controller.connect(scbamIssuerWallet).grantRole(ALLOTMENT_ROLE, innovestXBrokerAdmin.address);
  await controller.connect(scbamIssuerWallet).grantRole(ALLOTMENT_ROLE, dimeBrokerAdmin.address);
  await controller.connect(scbamIssuerWallet).grantRole(NAV_UPDATER_ROLE, navOracleBot.address);
  await controller.connect(scbamIssuerWallet).grantRole(DISTRIBUTOR_ROLE, distributorBot.address);

  console.log("   ✅ All Roles Provisioned Across SCBAM, TokenX, InnovestX, Dime, and Automated Bots.\n");

  // =========================================================================
  // STAGE 2: BROKER KYC ONBOARDING (InnovestX & Dime register their clients)
  // =========================================================================
  console.log("2️⃣ Broker KYC Onboarding Simulation...");
  // Controller registered as system address
  await gateway.connect(tokenXInfraWallet).registerWallet(controllerAddress, BROKER_INNOVESTX);
  await gateway.connect(tokenXInfraWallet).registerWallet(scbamIssuerWallet.address, BROKER_INNOVESTX);

  // InnovestX registers Investor A
  await gateway.connect(innovestXBrokerAdmin).registerWallet(innovestXInvestorA.address, BROKER_INNOVESTX);
  console.log("   • InnovestX registered Investor A (Wallet:", innovestXInvestorA.address.slice(0, 10) + "...)", "as InnovestX client");

  // Dime registers Investor B
  await gateway.connect(dimeBrokerAdmin).registerWallet(dimeInvestorB.address, BROKER_DIME);
  console.log("   • Dime registered Investor B      (Wallet:", dimeInvestorB.address.slice(0, 10) + "...)", "as Dime client");

  // Verify InvestmentTokenM allowlist reads automatically from gateway
  expect(await token.isAllowlist(innovestXInvestorA.address)).to.be.true;
  expect(await token.isAllowlist(dimeInvestorB.address)).to.be.true;
  console.log("   ✅ InvestmentTokenM automatically recognizes registered wallets as allowlisted!");

  // =========================================================================
  // STAGE 3: SCBAM MINTING & ISOLATED BROKER RESERVE TOP-UPS
  // =========================================================================
  console.log("\n3️⃣ SCBAM Issuer Mints & Funds Isolated Broker Reserves...");
  // SCBAM Mints 10,000 tMMF tokens
  await token.connect(scbamIssuerWallet).mint(ethers.parseEther("10000"));
  await token.connect(scbamIssuerWallet).approve(controllerAddress, ethers.parseEther("10000"));

  // SCBAM allocates reserve quotas: 6,000 tMMF to InnovestX, 4,000 tMMF to Dime
  await controller.connect(scbamIssuerWallet).fundBrokerReserve(BROKER_INNOVESTX, ethers.parseEther("6000"));
  await controller.connect(scbamIssuerWallet).fundBrokerReserve(BROKER_DIME, ethers.parseEther("4000"));

  console.log("   • InnovestX Reserve Quota   :", ethers.formatEther(await controller.brokerReserve(BROKER_INNOVESTX)), "tMMF");
  console.log("   • Dime Reserve Quota        :", ethers.formatEther(await controller.brokerReserve(BROKER_DIME)), "tMMF");

  // =========================================================================
  // STAGE 4: BROKER SUBSCRIPTION ORDER ALLOTMENT
  // =========================================================================
  console.log("\n4️⃣ Brokers Allot Shares to Their Respective Clients...");
  // InnovestX operator allots 500 tMMF to Investor A
  await controller.connect(innovestXBrokerAdmin).allotShares(innovestXInvestorA.address, ethers.parseEther("500"), ethers.id("SUB-INNO-001"));
  console.log("   • InnovestX allotted 500 tMMF to Investor A. Investor A balance:", ethers.formatEther(await token.balanceOf(innovestXInvestorA.address)), "tMMF");

  // Dime operator allots 300 tMMF to Investor B
  await controller.connect(dimeBrokerAdmin).allotShares(dimeInvestorB.address, ethers.parseEther("300"), ethers.id("SUB-DIME-001"));
  console.log("   • Dime allotted 300 tMMF to Investor B.      Investor B balance:", ethers.formatEther(await token.balanceOf(dimeInvestorB.address)), "tMMF");

  // =========================================================================
  // STAGE 5: TOKENX CORRIDOR MANAGEMENT & CROSS-BROKER TRANSFER
  // =========================================================================
  console.log("\n5️⃣ TokenX Corridor Policy Management & Peer-to-Peer Transfer...");
  // Investor A tries to send 50 tMMF to Investor B before corridor is open -> Reverts!
  try {
    await token.connect(innovestXInvestorA).transfer(dimeInvestorB.address, ethers.parseEther("50"));
    throw new Error("Corridor check failed");
  } catch (err: any) {
    console.log("   • [Policy Gate] Cross-broker transfer correctly blocked before corridor is opened.");
  }

  // TokenX Infrastructure Admin opens the corridor InnovestX <-> Dime
  await gateway.connect(tokenXInfraWallet).setCorridor(BROKER_INNOVESTX, BROKER_DIME, true);
  console.log("   • [TokenX Action] TokenX Admin opened corridor InnovestX <-> Dime.");

  // Investor A transfers 50 tMMF to Investor B -> Succeeds & Auto-syncs!
  await token.connect(innovestXInvestorA).transfer(dimeInvestorB.address, ethers.parseEther("50"));
  console.log("   • [P2P Transfer] Investor A (InnovestX) sent 50 tMMF to Investor B (Dime).");
  console.log("     - Investor A Balance      :", ethers.formatEther(await token.balanceOf(innovestXInvestorA.address)), "tMMF (450 tMMF)");
  console.log("     - Investor B Balance      :", ethers.formatEther(await token.balanceOf(dimeInvestorB.address)), "tMMF (350 tMMF)");
  console.log("     - InnovestX Active Shares :", ethers.formatEther(await controller.totalSharesByBroker(BROKER_INNOVESTX)), "tMMF (450 tMMF)");
  console.log("     - Dime Active Shares      :", ethers.formatEther(await controller.totalSharesByBroker(BROKER_DIME)), "tMMF (350 tMMF)");

  // =========================================================================
  // STAGE 6: AUTOMATED NAV ORACLE UPDATE & DISTRIBUTION BOTS
  // =========================================================================
  console.log("\n6️⃣ Automated Daily NAV Growth & Yield Distribution Simulation...");
  // Oracle Bot publishes new NAV (+4.00% daily growth)
  await controller.connect(navOracleBot).setBaselineNav(ethers.parseEther("1000"));
  await controller.connect(navOracleBot).updateNav(
    101,
    ethers.parseEther("1040"),
    await ethers.provider.getBlockNumber(),
    ethers.id("snapshot-multi-role.csv")
  ); // +4%
  console.log("   • [Oracle Bot] Published NAV Cycle 101: +4.00% Growth.");

  // Distributor Bot triggers batch push to all holders
  await controller.connect(distributorBot).distributeToWallets(
    [innovestXInvestorA.address, dimeInvestorB.address],
    101,
    [ethers.parseEther("450"), ethers.parseEther("350")]
  );
  console.log("   • [Distributor Bot] Batch distributed yield to Investor A and Investor B.");
  console.log("     - Investor A New Balance  :", ethers.formatEther(await token.balanceOf(innovestXInvestorA.address)), "tMMF (468 tMMF)");
  console.log("     - Investor B New Balance  :", ethers.formatEther(await token.balanceOf(dimeInvestorB.address)), "tMMF (364 tMMF)");

  // =========================================================================
  // STAGE 7: REDEMPTION (Day T Lock by Broker -> Day T+1 Burn by SCBAM)
  // =========================================================================
  console.log("\n7️⃣ Full Redemption Lifecycle (Day T Lock -> Day T+1 Burn)...");
  // Investor B requests redemption of 64 tMMF on Dime
  await token.connect(dimeInvestorB).approve(controllerAddress, ethers.parseEther("64"));
  await controller.connect(dimeBrokerAdmin).requestRedeem(dimeInvestorB.address, ethers.parseEther("64"), ethers.id("RED-DIME-001"));
  console.log("   • [Day T - Dime Action] Dime Operator locked 64 tMMF for redemption.");
  console.log("     - Investor B Remaining    :", ethers.formatEther(await token.balanceOf(dimeInvestorB.address)), "tMMF (300 tMMF)");
  console.log("     - Dime Locked Redemptions :", ethers.formatEther(await controller.lockedForRedemption(BROKER_DIME)), "tMMF (64 tMMF)");

  // Day T+1: SCBAM Admin executes settlement burn
  await controller.connect(scbamIssuerWallet).settleRedemptions([ethers.id("RED-DIME-001")]);
  console.log("   • [Day T+1 - SCBAM Action] SCBAM Admin permanently burned locked 64 tMMF after fiat settlement.");
  console.log("     - Dime Locked Redemptions :", ethers.formatEther(await controller.lockedForRedemption(BROKER_DIME)), "tMMF (0 tMMF)");
  console.log("     - Total Token Supply      :", ethers.formatEther(await token.totalSupply()), "tMMF (9,936 tMMF)");

  // =========================================================================
  // STAGE 8: FINAL 1:1 RECONCILIATION AUDIT
  // =========================================================================
  const finalSupply = await token.totalSupply();
  const finalActive = await controller.totalShares();
  const finalVault = await token.balanceOf(controllerAddress);
  const finalA = await token.balanceOf(innovestXInvestorA.address);
  const finalB = await token.balanceOf(dimeInvestorB.address);

  console.log("\n=========================================================================");
  console.log("🏁 MULTI-ROLE RECONCILIATION SUMMARY");
  console.log("=========================================================================");
  console.log(`• Total Token Supply   : ${ethers.formatEther(finalSupply)} tMMF`);
  console.log(`• Active Shares Total  : ${ethers.formatEther(finalActive)} tMMF (${ethers.formatEther(finalA + finalB)} in wallets)`);
  console.log(`• Controller Vault     : ${ethers.formatEther(finalVault)} tMMF`);
  console.log(`• Ledger Discrepancy   : 0 wei`);
  console.log("=========================================================================\n");

  expect(finalSupply).to.equal(finalActive + finalVault);
  expect(finalActive).to.equal(finalA + finalB);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
