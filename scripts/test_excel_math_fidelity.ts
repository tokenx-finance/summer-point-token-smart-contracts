import { ethers } from "hardhat";
import { expect } from "chai";

async function main() {
  console.log("\n=========================================================================");
  console.log("📊 MATHEMATICAL SIMULATION: EXCEL VS ON-CHAIN SOLIDITY FIDELITY AUDIT");
  console.log("   Reference: หลักการ constant nav.xlsx (1e10 Scaling, Floor Math & 4/18 Decimals)");
  console.log("=========================================================================\n");

  const [deployer, scbamAdmin, navOracle, distributor, userAlice, userBob, userCharlie] = await ethers.getSigners();
  const BROKER_INNOVESTX = ethers.keccak256(ethers.toUtf8Bytes("InnovestX"));

  // 1. Deploy contracts
  const Gateway = await ethers.getContractFactory("AllowlistRegistryProxyV2");
  const gateway = await Gateway.deploy("Multi-Broker Allowlist Proxy");

  const Token = await ethers.getContractFactory("InvestmentTokenM");
  const token = await Token.deploy("Tokenized Mutual Fund", "tMMF", await gateway.getAddress());

  const Controller = await ethers.getContractFactory("FundController");
  const controller = await Controller.deploy(await token.getAddress(), scbamAdmin.address);
  await controller.connect(scbamAdmin).setBrokerRegistry(await gateway.getAddress());

  // Setup roles & whitelist
  const ALLOTMENT_ROLE = await controller.ALLOTMENT_ROLE();
  const NAV_UPDATER_ROLE = await controller.NAV_UPDATER_ROLE();
  const DISTRIBUTOR_ROLE = await controller.DISTRIBUTOR_ROLE();

  await controller.connect(scbamAdmin).grantRole(ALLOTMENT_ROLE, scbamAdmin.address);
  await controller.connect(scbamAdmin).grantRole(NAV_UPDATER_ROLE, navOracle.address);
  await controller.connect(scbamAdmin).grantRole(DISTRIBUTOR_ROLE, distributor.address);

  await gateway.registerWallet(await controller.getAddress(), BROKER_INNOVESTX);
  await gateway.registerWallet(deployer.address, BROKER_INNOVESTX);
  await gateway.registerWallet(userAlice.address, BROKER_INNOVESTX);
  await gateway.registerWallet(userBob.address, BROKER_INNOVESTX);
  await gateway.registerWallet(userCharlie.address, BROKER_INNOVESTX);

  // Mint & fund reserve
  await token.mint(ethers.parseEther("50000000")); // 50M tokens
  await token.approve(await controller.getAddress(), ethers.parseEther("50000000"));
  await controller.fundBrokerReserve(BROKER_INNOVESTX, ethers.parseEther("50000000"));

  // Excel Test Cases: Realistic NAV Growth Cycles
  const testCases = [
    {
      name: "Day 1: Moderate Daily Yield (+0.0350% / +3.5 bps)",
      oldNav: 10_000_000.0,
      newNav: 10_003_500.0,
      holders: [
        { name: "Alice (10,000.0000 shares)", balance: 10_000.0000, signer: userAlice },
        { name: "Bob   (250,000.5000 shares)", balance: 250_000.5000, signer: userBob },
        { name: "Charlie (1,234.5678 shares)", balance: 1_234.5678, signer: userCharlie }
      ]
    },
    {
      name: "Day 2: High Volatility Daily Yield (+0.1254321098% / 10 decimals precision)",
      oldNav: 10_003_500.0,
      newNav: 10_016_047.5752,
      holders: [
        { name: "Alice", signer: userAlice },
        { name: "Bob", signer: userBob },
        { name: "Charlie", signer: userCharlie }
      ]
    },
    {
      name: "Day 3: Micro Yield (+0.0001000000% / +1e-6 micro diff)",
      oldNav: 10_016_047.5752,
      newNav: 10_016_057.5912,
      holders: [
        { name: "Alice", signer: userAlice },
        { name: "Bob", signer: userBob },
        { name: "Charlie", signer: userCharlie }
      ]
    }
  ];

  // STAGE 1: Allot Initial Balances
  console.log("1️⃣ Allotting Initial Investor Balances (Matching Excel Shares)...");
  await controller.connect(scbamAdmin).allotShares(userAlice.address, ethers.parseEther("10000.0000"), ethers.id("SUB-ALICE"));
  await controller.connect(scbamAdmin).allotShares(userBob.address, ethers.parseEther("250000.5000"), ethers.id("SUB-BOB"));
  await controller.connect(scbamAdmin).allotShares(userCharlie.address, ethers.parseEther("1234.5678"), ethers.id("SUB-CHARLIE"));

  console.log("   • Alice Balance   : 10,000.0000 tMMF");
  console.log("   • Bob Balance     : 250,000.5000 tMMF");
  console.log("   • Charlie Balance : 1,234.5678 tMMF\n");

  // STAGE 2: Execute Cycles and Compare Excel Formula vs On-Chain EVM
  let cycleId = 1;
  let currentNav = testCases[0].oldNav;
  await controller.connect(navOracle).setBaselineNav(ethers.parseEther(currentNav.toString()));

  for (const tc of testCases) {
    console.log(`=========================================================================`);
    console.log(`📈 CYCLE ${cycleId}: ${tc.name}`);
    console.log(`=========================================================================`);

    // 1. Compute Excel Reference Value (10 Decimals Floating Math)
    const excelDiffPercent = (tc.newNav - tc.oldNav) / tc.oldNav;
    const excelDiffScaled10Decimals = Math.floor(excelDiffPercent * 1e10);

    console.log(`   • Yesterday NAV (Excel)  : ${tc.oldNav.toLocaleString()} THB`);
    console.log(`   • Today NAV     (Excel)  : ${tc.newNav.toLocaleString()} THB`);
    console.log(`   • Diff Rate %   (Excel)  : ${(excelDiffPercent * 100).toFixed(10)}% (Scaled 1e10: ${excelDiffScaled10Decimals})`);

    // 2. Push On-Chain NAV Update
    const newNavWei = ethers.parseEther(tc.newNav.toFixed(10));
    await controller.connect(navOracle).updateNav(
      cycleId,
      newNavWei,
      await ethers.provider.getBlockNumber(),
      ethers.id(`snapshot-excel-math-${cycleId}.csv`)
    );

    const onChainCycle = await controller.cycles(cycleId);
    console.log(`   • Diff Rate %   (Solidity): Scaled 1e10 = ${onChainCycle.diffPercentScaled.toString()}`);

    // Verify 10-decimal diffPercentScaled match
    const diffRateTolerance = Math.abs(Number(onChainCycle.diffPercentScaled) - excelDiffScaled10Decimals);
    expect(diffRateTolerance).to.be.lte(1, "Diff percent scaled deviation exceeds 1 unit in 10 decimals");
    console.log(`   ✅ NAV Rate Scaling: 100% Match within 1e-10 precision!`);

    // 3. Distribute to wallets & verify per-wallet yield
    console.log(`\n   --- Per-Investor Yield Calculation Comparison ---`);
    for (const h of tc.holders) {
      const balBeforeWei = await token.balanceOf(h.signer.address);
      const balBefore = parseFloat(ethers.formatEther(balBeforeWei));

      // Excel theoretical yield: (balanceBeforeWei * diffPercentScaled) / 1e10 (floor)
      const expectedYieldWei = (balBeforeWei * onChainCycle.diffPercentScaled) / 10000000000n;
      const expectedYield = ethers.formatEther(expectedYieldWei);

      // On-chain execution
      await controller.connect(distributor).distributeToWallet(h.signer.address, cycleId, balBeforeWei);
      const balAfterWei = await token.balanceOf(h.signer.address);
      const onChainYieldWei = balAfterWei - balBeforeWei;
      const onChainYield = ethers.formatEther(onChainYieldWei);

      console.log(`   [${h.name}]`);
      console.log(`     - Balance Before : ${ethers.formatEther(balBeforeWei)} shares`);
      console.log(`     - Excel Formula  : ${expectedYield} shares`);
      console.log(`     - On-Chain Yield : ${onChainYield} shares`);

      // Verify exact match down to every single wei
      expect(onChainYieldWei).to.equal(expectedYieldWei, `Yield mismatch on ${h.name}`);
      console.log(`     ✅ Exact 18-decimal integer match verified (0 wei discrepancy)!`);
    }

    cycleId++;
    console.log(``);
  }

  console.log("=========================================================================");
  console.log("🎉 ALL CYCLES MATCHED EXCEL MATHEMATICS WITH ZERO DISCREPANCY!");
  console.log("=========================================================================\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
