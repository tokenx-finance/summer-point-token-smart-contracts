import { expect } from "chai";
import { ethers } from "hardhat";
import {
  FundController,
  InvestmentTokenM,
  AllowlistRegistryProxyV2,
  FundComplianceHook,
  AllowlistRegistry
} from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("Day T / T+1 Asynchronous Redemption & Yield Distribution Lifecycle", () => {
  let scbamTreasury: HardhatEthersSigner;
  let tokenXAdmin: HardhatEthersSigner;
  let tokenXOracleBot: HardhatEthersSigner;
  let tokenXDistributorBot: HardhatEthersSigner;
  let innovestXAdmin: HardhatEthersSigner;
  let dimeAdmin: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let charlie: HardhatEthersSigner;

  let token: InvestmentTokenM;
  let controller: FundController;
  let hook: FundComplianceHook;
  let proxy: AllowlistRegistryProxyV2;
  let innovestXRegistry: AllowlistRegistry;
  let dimeRegistry: AllowlistRegistry;

  const BROKER_INNOVESTX = ethers.keccak256(ethers.toUtf8Bytes("INNOVESTX"));
  const BROKER_DIME = ethers.keccak256(ethers.toUtf8Bytes("DIME"));
  const REPORT_HASH = ethers.id("snapshot-report.csv");

  beforeEach(async () => {
    [
      scbamTreasury,
      tokenXAdmin,
      tokenXOracleBot,
      tokenXDistributorBot,
      innovestXAdmin,
      dimeAdmin,
      alice,
      bob,
      charlie
    ] = await ethers.getSigners();

    // 1. Deploy Registries & Proxy
    const RegistryFactory = await ethers.getContractFactory("AllowlistRegistry");
    innovestXRegistry = await RegistryFactory.connect(innovestXAdmin).deploy();
    dimeRegistry = await RegistryFactory.connect(dimeAdmin).deploy();

    const ProxyFactory = await ethers.getContractFactory("AllowlistRegistryProxyV2");
    proxy = await ProxyFactory.connect(tokenXAdmin).deploy("Token X Proxy");

    await proxy.connect(tokenXAdmin).addRegistry("INNOVESTX", await innovestXRegistry.getAddress());
    await proxy.connect(tokenXAdmin).addRegistry("DIME", await dimeRegistry.getAddress());

    await innovestXRegistry.connect(innovestXAdmin).addAllowlist(alice.address);
    await innovestXRegistry.connect(innovestXAdmin).addAllowlist(bob.address);
    await dimeRegistry.connect(dimeAdmin).addAllowlist(charlie.address);

    // 2. Deploy Token & FundController
    const TokenFactory = await ethers.getContractFactory("InvestmentTokenM");
    token = await TokenFactory.connect(scbamTreasury).deploy("SCBAM tMMF", "tMMF", await proxy.getAddress());

    const ControllerFactory = await ethers.getContractFactory("FundController");
    controller = await ControllerFactory.connect(scbamTreasury).deploy(await token.getAddress(), scbamTreasury.address);

    // 3. Deploy Compliance Hook
    const HookFactory = await ethers.getContractFactory("FundComplianceHook");
    hook = await HookFactory.connect(tokenXAdmin).deploy(
      await token.getAddress(),
      await proxy.getAddress(),
      await controller.getAddress()
    );

    await token.connect(scbamTreasury).setTransferHook(await hook.getAddress());
    await hook.connect(tokenXAdmin).setMinHoldingConfig(ethers.parseEther("10"), true);
    await controller.connect(scbamTreasury).setBrokerRegistry(await proxy.getAddress());
    await controller.connect(scbamTreasury).setComplianceHook(await hook.getAddress());

    await proxy.connect(tokenXAdmin).setCorridor(BROKER_INNOVESTX, BROKER_DIME, true);
    await proxy.connect(tokenXAdmin).registerWallet(await controller.getAddress(), BROKER_INNOVESTX);
    await proxy.connect(tokenXAdmin).registerWallet(scbamTreasury.address, BROKER_INNOVESTX);

    // 4. Grant Roles
    const NAV_UPDATER_ROLE = await controller.NAV_UPDATER_ROLE();
    const DISTRIBUTOR_ROLE = await controller.DISTRIBUTOR_ROLE();
    const ALLOTMENT_ROLE = await controller.ALLOTMENT_ROLE();

    await controller.connect(scbamTreasury).grantRole(NAV_UPDATER_ROLE, tokenXOracleBot.address);
    await controller.connect(scbamTreasury).grantRole(DISTRIBUTOR_ROLE, tokenXDistributorBot.address);
    await controller.connect(scbamTreasury).grantRole(ALLOTMENT_ROLE, innovestXAdmin.address);
    await controller.connect(scbamTreasury).grantRole(ALLOTMENT_ROLE, dimeAdmin.address);

    // 5. Mint Supply & Fund Reserves
    const mintAmount = ethers.parseEther("1000000"); // 1M tMMF
    await token.connect(scbamTreasury).mint(mintAmount);
    await token.connect(scbamTreasury).approve(await controller.getAddress(), mintAmount);

    await controller.connect(scbamTreasury).fundBrokerReserve(BROKER_INNOVESTX, ethers.parseEther("200000"));
    await controller.connect(scbamTreasury).fundBrokerReserve(BROKER_DIME, ethers.parseEther("200000"));

    // Initial Allotments: Alice 100k, Bob 50k, Charlie 80k
    await controller.connect(innovestXAdmin).allotShares(alice.address, ethers.parseEther("100000"), ethers.id("ALLOT-ALICE"));
    await controller.connect(innovestXAdmin).allotShares(bob.address, ethers.parseEther("50000"), ethers.id("ALLOT-BOB"));
    await controller.connect(dimeAdmin).allotShares(charlie.address, ethers.parseEther("80000"), ethers.id("ALLOT-CHARLIE"));
  });

  it("1. Day T Redemption locks shares and prevents yield accrual on redeemed units during Day T distribution", async () => {
    // Initial State: Alice has 100,000 tMMF
    expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("100000"));
    expect(await controller.totalSharesByBroker(BROKER_INNOVESTX)).to.equal(ethers.parseEther("150000")); // Alice 100k + Bob 50k

    // -------------------------------------------------------------
    // DAY T (14:00): Alice requests redemption of 40,000 tMMF
    // -------------------------------------------------------------
    const refRedeemAlice = ethers.keccak256(ethers.toUtf8Bytes("REDEEM-ALICE-DAY-T"));
    await token.connect(alice).approve(await controller.getAddress(), ethers.parseEther("40000"));
    
    await expect(controller.connect(innovestXAdmin).requestRedeem(alice.address, ethers.parseEther("40000"), refRedeemAlice))
      .to.emit(controller, "RedeemRequested")
      .withArgs(alice.address, BROKER_INNOVESTX, ethers.parseEther("40000"), refRedeemAlice);

    // Verify canonical RedemptionRequest state
    const req = await controller.redemptionRequests(refRedeemAlice);
    expect(req.wallet).to.equal(alice.address);
    expect(req.broker).to.equal(BROKER_INNOVESTX);
    expect(req.amount).to.equal(ethers.parseEther("40000"));
    expect(req.status).to.equal(1n); // 1 = PENDING

    // Assert Day T Escrow State
    expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("60000"));
    expect(await controller.lockedForRedemption(BROKER_INNOVESTX)).to.equal(ethers.parseEther("40000"));
    expect(await controller.totalSharesByBroker(BROKER_INNOVESTX)).to.equal(ethers.parseEther("110000")); // 150k - 40k

    // -------------------------------------------------------------
    // DAY T (18:00): Daily NAV Growth & Push Yield Distribution (+1.00%)
    // -------------------------------------------------------------
    await controller.connect(tokenXOracleBot).setBaselineNav(ethers.parseEther("230000"));
    const cycleDayT = ethers.keccak256(ethers.toUtf8Bytes("CYCLE-DAY-T"));
    const snapshotBlock = await ethers.provider.getBlockNumber();
    await controller.connect(tokenXOracleBot).updateNav(
      cycleDayT,
      ethers.parseEther("232300"),
      snapshotBlock,
      REPORT_HASH
    );

    // Yield preview for Alice should be calculated ONLY on remaining 60,000 tMMF balance
    const reportedAliceBalance = ethers.parseEther("60000");
    const alicePreview = await controller.previewDistribution(reportedAliceBalance, cycleDayT);
    expect(alicePreview).to.equal(ethers.parseEther("600")); // 1.00% of 60,000 = 600 tMMF

    // Distribute yield to Alice
    await controller.connect(tokenXDistributorBot).distributeToWallet(alice.address, cycleDayT, reportedAliceBalance);

    // Alice balance is 60,000 + 600 = 60,600 tMMF (NOT 101,000)
    expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("60600"));

    // -------------------------------------------------------------
    // DAY T+1 (09:00): SCBAM confirms off-chain fiat wire & settles redemptions
    // -------------------------------------------------------------
    const totalSupplyBeforeBurn = await token.totalSupply();
    
    await expect(controller.connect(scbamTreasury).settleRedemptions([refRedeemAlice]))
      .to.emit(controller, "RedemptionsSettled")
      .withArgs([refRedeemAlice], ethers.parseEther("40000"), scbamTreasury.address);

    const settledReq = await controller.redemptionRequests(refRedeemAlice);
    expect(settledReq.status).to.equal(3n); // 3 = SETTLED

    // Total supply decreased by exactly 40,000 tMMF
    expect(await token.totalSupply()).to.equal(totalSupplyBeforeBurn - ethers.parseEther("40000"));
    expect(await controller.lockedForRedemption(BROKER_INNOVESTX)).to.equal(0n);
    expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("60600"));
  });

  it("2. Cancellation of Day T redemption before T+1 burn refunds tokens and restores full yield accrual on Day T+1", async () => {
    // Initial State: Bob has 50,000 tMMF
    const refRedeemBob = ethers.keccak256(ethers.toUtf8Bytes("REDEEM-BOB-REFUND"));
    await token.connect(bob).approve(await controller.getAddress(), ethers.parseEther("20000"));

    // Day T: Bob requests 20,000 redemption
    await controller.connect(innovestXAdmin).requestRedeem(bob.address, ethers.parseEther("20000"), refRedeemBob);
    expect(await token.balanceOf(bob.address)).to.equal(ethers.parseEther("30000"));

    // Day T Evening: +1.00% yield distribution
    await controller.connect(tokenXOracleBot).setBaselineNav(ethers.parseEther("200000"));
    const cycleDayT = ethers.keccak256(ethers.toUtf8Bytes("CYCLE-DAY-T"));
    await controller.connect(tokenXOracleBot).updateNav(
      cycleDayT,
      ethers.parseEther("202000"),
      await ethers.provider.getBlockNumber(),
      REPORT_HASH
    );

    // Bob receives yield on 30,000 tMMF (+300 tMMF)
    await controller.connect(tokenXDistributorBot).distributeToWallet(
      bob.address,
      cycleDayT,
      ethers.parseEther("30000")
    );
    expect(await token.balanceOf(bob.address)).to.equal(ethers.parseEther("30300"));

    const totalSharesBeforeCancellation = await controller.totalShares();
    const brokerSharesBeforeCancellation = await controller.totalSharesByBroker(BROKER_INNOVESTX);

    // -------------------------------------------------------------
    // Day T+1 Morning: Bank wire bounced -> SCBAM cancels redemption by refId
    // -------------------------------------------------------------
    await expect(controller.connect(scbamTreasury).cancelRedeem(refRedeemBob))
      .to.emit(controller, "RedeemCancelled")
      .withArgs(bob.address, BROKER_INNOVESTX, ethers.parseEther("20000"), refRedeemBob);

    const cancelledReq = await controller.redemptionRequests(refRedeemBob);
    expect(cancelledReq.status).to.equal(2n); // 2 = CANCELLED

    // Bob receives his 20,000 tMMF back -> 30,300 + 20,000 = 50,300 tMMF
    expect(await token.balanceOf(bob.address)).to.equal(ethers.parseEther("50300"));
    expect(await controller.lockedForRedemption(BROKER_INNOVESTX)).to.equal(0n);
    expect(await controller.totalShares()).to.equal(totalSharesBeforeCancellation + ethers.parseEther("20000"));
    expect(await controller.totalSharesByBroker(BROKER_INNOVESTX)).to.equal(
      brokerSharesBeforeCancellation + ethers.parseEther("20000")
    );

    // -------------------------------------------------------------
    // Day T+1 Evening: Next Cycle NAV Yield (+1.00%)
    // -------------------------------------------------------------
    const cycleDayT1 = ethers.keccak256(ethers.toUtf8Bytes("CYCLE-DAY-T1"));
    await controller.connect(tokenXOracleBot).updateNav(
      cycleDayT1,
      ethers.parseEther("204020"),
      await ethers.provider.getBlockNumber(),
      ethers.id("snapshot-report-day-t1.csv")
    );

    // Bob now earns yield on his full restored balance (50,300 tMMF) -> +503 tMMF
    await controller.connect(tokenXDistributorBot).distributeToWallet(
      bob.address,
      cycleDayT1,
      ethers.parseEther("50300")
    );
    expect(await token.balanceOf(bob.address)).to.equal(ethers.parseEther("50803"));
  });

  it("3. Multi-broker Day T+1 batch settlement preserves exact 0-wei mathematical conservation", async () => {
    // Alice (InnovestX) redeems 30k, Charlie (Dime) redeems 25k on Day T
    const refAlice = ethers.keccak256(ethers.toUtf8Bytes("REDEEM-ALICE-MULTI"));
    const refCharlie = ethers.keccak256(ethers.toUtf8Bytes("REDEEM-CHARLIE-MULTI"));

    await token.connect(alice).approve(await controller.getAddress(), ethers.parseEther("30000"));
    await token.connect(charlie).approve(await controller.getAddress(), ethers.parseEther("25000"));

    await controller.connect(innovestXAdmin).requestRedeem(alice.address, ethers.parseEther("30000"), refAlice);
    await controller.connect(dimeAdmin).requestRedeem(charlie.address, ethers.parseEther("25000"), refCharlie);

    // Day T yield (+0.50%)
    await controller.connect(tokenXOracleBot).setBaselineNav(ethers.parseEther("175000"));
    const cycle = ethers.keccak256(ethers.toUtf8Bytes("CYCLE-MULTI"));
    await controller.connect(tokenXOracleBot).updateNav(
      cycle,
      ethers.parseEther("175875"),
      await ethers.provider.getBlockNumber(),
      REPORT_HASH
    );

    await controller.connect(tokenXDistributorBot).distributeToWallets(
      [alice.address, bob.address, charlie.address],
      cycle,
      [ethers.parseEther("70000"), ethers.parseEther("50000"), ethers.parseEther("55000")]
    );

    // Day T+1: SCBAM settles both multi-broker refIds in one transaction!
    const totalSupplyBefore = await token.totalSupply();
    const escrowBefore = await token.balanceOf(await controller.getAddress());
    await expect(controller.connect(scbamTreasury).settleRedemptions([refAlice, refCharlie]))
      .to.emit(controller, "RedemptionsSettled")
      .withArgs([refAlice, refCharlie], ethers.parseEther("55000"), scbamTreasury.address);

    expect(await controller.lockedForRedemption(BROKER_INNOVESTX)).to.equal(0n);
    expect(await controller.lockedForRedemption(BROKER_DIME)).to.equal(0n);
    expect((await controller.redemptionRequests(refAlice)).status).to.equal(3n);
    expect((await controller.redemptionRequests(refCharlie)).status).to.equal(3n);
    expect(await token.balanceOf(await controller.getAddress())).to.equal(escrowBefore - ethers.parseEther("55000"));
    expect(await token.totalSupply()).to.equal(totalSupplyBefore - ethers.parseEther("55000"));

    // Verify Invariant Conservation: totalSupply == treasury + activeShares + vault
    const totalSupply = await token.totalSupply();
    const treasuryBalance = await token.balanceOf(scbamTreasury.address);
    const activeShares = await controller.totalShares();
    const vaultBalance = await token.balanceOf(await controller.getAddress());

    expect(totalSupply).to.equal(treasuryBalance + activeShares + vaultBalance);
  });

  describe("4. Exploit & Edge-Case Security Suite for Redemption Lifecycle", () => {
    describe("Exploit Tests", () => {
      it("4.1 Fake refId cancellation reverts without changing escrow or ledgers", async () => {
        const fakeRef = ethers.id("FAKE-REF");
        await expect(controller.connect(scbamTreasury).cancelRedeem(fakeRef))
          .to.be.revertedWithCustomError(controller, "RedemptionNotFound")
          .withArgs(fakeRef);
      });

      it("4.2 Double cancellation reverts", async () => {
        const refBob = ethers.id("BOB-DOUBLE-CANCEL");
        await token.connect(bob).approve(await controller.getAddress(), ethers.parseEther("5000"));
        await controller.connect(innovestXAdmin).requestRedeem(bob.address, ethers.parseEther("5000"), refBob);

        await controller.connect(scbamTreasury).cancelRedeem(refBob);

        await expect(controller.connect(scbamTreasury).cancelRedeem(refBob))
          .to.be.revertedWithCustomError(controller, "RedemptionNotPending")
          .withArgs(refBob, 2n); // 2 = CANCELLED
      });

      it("4.3 Cancellation after settlement reverts", async () => {
        const refAlice = ethers.id("ALICE-SETTLE-THEN-CANCEL");
        await token.connect(alice).approve(await controller.getAddress(), ethers.parseEther("5000"));
        await controller.connect(innovestXAdmin).requestRedeem(alice.address, ethers.parseEther("5000"), refAlice);

        await controller.connect(scbamTreasury).settleRedemptions([refAlice]);

        await expect(controller.connect(scbamTreasury).cancelRedeem(refAlice))
          .to.be.revertedWithCustomError(controller, "RedemptionNotPending")
          .withArgs(refAlice, 3n); // 3 = SETTLED
      });

      it("4.4 Settlement after cancellation reverts", async () => {
        const refBob = ethers.id("BOB-CANCEL-THEN-SETTLE");
        await token.connect(bob).approve(await controller.getAddress(), ethers.parseEther("5000"));
        await controller.connect(innovestXAdmin).requestRedeem(bob.address, ethers.parseEther("5000"), refBob);

        await controller.connect(scbamTreasury).cancelRedeem(refBob);

        await expect(controller.connect(scbamTreasury).settleRedemptions([refBob]))
          .to.be.revertedWithCustomError(controller, "RedemptionNotPending")
          .withArgs(refBob, 2n); // 2 = CANCELLED
      });

      it("4.5 Double settlement reverts", async () => {
        const refCharlie = ethers.id("CHARLIE-DOUBLE-SETTLE");
        await token.connect(charlie).approve(await controller.getAddress(), ethers.parseEther("5000"));
        await controller.connect(dimeAdmin).requestRedeem(charlie.address, ethers.parseEther("5000"), refCharlie);

        await controller.connect(scbamTreasury).settleRedemptions([refCharlie]);

        await expect(controller.connect(scbamTreasury).settleRedemptions([refCharlie]))
          .to.be.revertedWithCustomError(controller, "RedemptionNotPending")
          .withArgs(refCharlie, 3n); // 3 = SETTLED
      });

      it("4.6 A batch containing one invalid refId reverts atomically without partial state changes", async () => {
        const refAlice = ethers.id("ALICE-BATCH-ATOMIC-1");
        const refFake = ethers.id("FAKE-BATCH-ATOMIC-2");

        await token.connect(alice).approve(await controller.getAddress(), ethers.parseEther("5000"));
        await controller.connect(innovestXAdmin).requestRedeem(alice.address, ethers.parseEther("5000"), refAlice);

        const lockedBefore = await controller.lockedForRedemption(BROKER_INNOVESTX);

        await expect(controller.connect(scbamTreasury).settleRedemptions([refAlice, refFake]))
          .to.be.revertedWithCustomError(controller, "RedemptionNotFound")
          .withArgs(refFake);

        // State remains PENDING for refAlice, and locked remains intact
        const req = await controller.redemptionRequests(refAlice);
        expect(req.status).to.equal(1n); // PENDING
        expect(await controller.lockedForRedemption(BROKER_INNOVESTX)).to.equal(lockedBefore);
      });

      it("4.7 Empty settlement and cancellation batches revert", async () => {
        await expect(controller.connect(scbamTreasury).settleRedemptions([]))
          .to.be.revertedWithCustomError(controller, "EmptyBatch");

        await expect(controller.connect(scbamTreasury).cancelRedeemBatch([]))
          .to.be.revertedWithCustomError(controller, "EmptyBatch");
      });

      it("4.8 Non-admin cancellation and settlement revert", async () => {
        const refAlice = ethers.id("ALICE-NON-ADMIN");
        await token.connect(alice).approve(await controller.getAddress(), ethers.parseEther("5000"));
        await controller.connect(innovestXAdmin).requestRedeem(alice.address, ethers.parseEther("5000"), refAlice);

        await expect(controller.connect(alice).cancelRedeem(refAlice))
          .to.be.reverted;

        await expect(controller.connect(alice).settleRedemptions([refAlice]))
          .to.be.reverted;
      });

      it("4.9 Cross-workflow refId collision guard prevents reusing refIds", async () => {
        const collisionRef = ethers.id("COLLISION-REF-01");
        await token.connect(alice).approve(await controller.getAddress(), ethers.parseEther("5000"));
        await controller.connect(innovestXAdmin).requestRedeem(alice.address, ethers.parseEther("5000"), collisionRef);

        // Attempting to request subscription with the same refId reverts with RefIdAlreadyUsed
        await expect(controller.connect(innovestXAdmin).requestSubscribe(bob.address, ethers.parseEther("100"), collisionRef))
          .to.be.revertedWithCustomError(controller, "RefIdAlreadyUsed")
          .withArgs(collisionRef);

        // Attempting direct allotment with same refId reverts
        await expect(controller.connect(innovestXAdmin).allotShares(bob.address, ethers.parseEther("100"), collisionRef))
          .to.be.revertedWithCustomError(controller, "RefIdAlreadyUsed")
          .withArgs(collisionRef);
      });

      it("4.10 Duplicate refId in one settlement batch reverts atomically", async () => {
        const refAlice = ethers.id("ALICE-DUPLICATE-IN-BATCH");
        const amount = ethers.parseEther("5000");
        await token.connect(alice).approve(await controller.getAddress(), amount);
        await controller.connect(innovestXAdmin).requestRedeem(alice.address, amount, refAlice);

        const supplyBefore = await token.totalSupply();
        const escrowBefore = await token.balanceOf(await controller.getAddress());
        const lockedBefore = await controller.lockedForRedemption(BROKER_INNOVESTX);

        await expect(controller.connect(scbamTreasury).settleRedemptions([refAlice, refAlice]))
          .to.be.revertedWithCustomError(controller, "RedemptionNotPending")
          .withArgs(refAlice, 3n);

        expect((await controller.redemptionRequests(refAlice)).status).to.equal(1n);
        expect(await controller.lockedForRedemption(BROKER_INNOVESTX)).to.equal(lockedBefore);
        expect(await token.balanceOf(await controller.getAddress())).to.equal(escrowBefore);
        expect(await token.totalSupply()).to.equal(supplyBefore);
      });

      it("4.11 Paused token burn rolls back settlement state", async () => {
        const refAlice = ethers.id("ALICE-PAUSED-TOKEN-SETTLEMENT");
        const amount = ethers.parseEther("5000");
        await token.connect(alice).approve(await controller.getAddress(), amount);
        await controller.connect(innovestXAdmin).requestRedeem(alice.address, amount, refAlice);

        const supplyBefore = await token.totalSupply();
        const escrowBefore = await token.balanceOf(await controller.getAddress());
        const lockedBefore = await controller.lockedForRedemption(BROKER_INNOVESTX);
        await token.connect(scbamTreasury).pause();

        await expect(controller.connect(scbamTreasury).settleRedemptions([refAlice]))
          .to.be.revertedWith("Pausable: paused");

        expect((await controller.redemptionRequests(refAlice)).status).to.equal(1n);
        expect(await controller.lockedForRedemption(BROKER_INNOVESTX)).to.equal(lockedBefore);
        expect(await token.balanceOf(await controller.getAddress())).to.equal(escrowBefore);
        expect(await token.totalSupply()).to.equal(supplyBefore);
      });
    });
  });
});
