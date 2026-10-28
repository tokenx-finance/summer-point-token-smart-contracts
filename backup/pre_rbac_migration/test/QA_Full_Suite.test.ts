import { expect } from "chai";
import { ethers } from "hardhat";

describe("QA Comprehensive End-to-End Test Suite", () => {
  // Contracts
  let token: any;
  let gateway: any;
  let controller: any;
  let hook: any;

  // Signers / Accounts
  let admin: any;
  let navUpdater: any;
  let distributor: any;
  let allotmentAdmin: any;
  let registrar: any;
  let corridorAdmin: any;

  // Investor Wallets
  let innovestX_1: any;   // InnovestX Broker
  let innovestX_2: any;   // InnovestX Broker
  let dime_1: any;        // Dime Broker
  let dime_2: any;        // Dime Broker
  let thirdBroker_1: any; // Third Broker
  let unregistered: any;  // Unregistered

  // Constants
  const BROKER_INNOVESTX = ethers.keccak256(ethers.toUtf8Bytes("InnovestX"));
  const BROKER_DIME = ethers.keccak256(ethers.toUtf8Bytes("Dime"));
  const BROKER_THIRD = ethers.keccak256(ethers.toUtf8Bytes("ThirdBroker"));

  const TEN_TOKENS = ethers.parseEther("10");
  const FIVE_TOKENS = ethers.parseEther("5");
  const FIFTEEN_TOKENS = ethers.parseEther("15");
  const TWENTY_TOKENS = ethers.parseEther("20");
  const ONE_HUNDRED_TOKENS = ethers.parseEther("100");
  const ONE_THOUSAND_TOKENS = ethers.parseEther("1000");
  const REPORT_HASH = ethers.id("qa-snapshot-report.csv");

  beforeEach(async () => {
    [
      admin,
      navUpdater,
      distributor,
      allotmentAdmin,
      registrar,
      corridorAdmin,
      innovestX_1,
      innovestX_2,
      dime_1,
      dime_2,
      thirdBroker_1,
      unregistered,
    ] = await ethers.getSigners();

    // 1. Deploy AllowlistRegistryProxyV2
    const Gateway = await ethers.getContractFactory("AllowlistRegistryProxyV2");
    gateway = await Gateway.deploy("Multi-Broker Allowlist Proxy");

    // Register investor wallets and admin/controller with brokers
    await gateway.connect(admin).registerWalletsBatch(
      [admin.address, innovestX_1.address, innovestX_2.address, dime_1.address, dime_2.address, thirdBroker_1.address],
      [BROKER_INNOVESTX, BROKER_INNOVESTX, BROKER_INNOVESTX, BROKER_DIME, BROKER_DIME, BROKER_THIRD]
    );

    // 2. Deploy InvestmentTokenM using gateway as its allowlistRegistry
    const Token = await ethers.getContractFactory("InvestmentTokenM");
    token = await Token.deploy("Tokenized Mutual Fund", "tMMF", await gateway.getAddress());

    // 3. Deploy FundController
    const Controller = await ethers.getContractFactory("FundController");
    controller = await Controller.deploy(await token.getAddress(), admin.address);
    await controller.setBrokerRegistry(await gateway.getAddress());

    // Register controller in gateway so token transfers from/to controller pass allowlist check
    await gateway.connect(admin).registerWallet(await controller.getAddress(), BROKER_INNOVESTX);

    // Grant Roles in FundController
    const NAV_UPDATER_ROLE = await controller.NAV_UPDATER_ROLE();
    const DISTRIBUTOR_ROLE = await controller.DISTRIBUTOR_ROLE();
    const ALLOTMENT_ROLE = await controller.ALLOTMENT_ROLE();
    await controller.grantRole(NAV_UPDATER_ROLE, navUpdater.address);
    await controller.grantRole(DISTRIBUTOR_ROLE, distributor.address);
    await controller.grantRole(ALLOTMENT_ROLE, allotmentAdmin.address);

    // 4. Deploy FundComplianceHook
    const Hook = await ethers.getContractFactory("FundComplianceHook");
    hook = await Hook.deploy(
      await token.getAddress(),
      await gateway.getAddress(),
      await controller.getAddress()
    );

    // Configure 10 tMMF minimum holding rule on hook
    await hook.setMinHoldingConfig(TEN_TOKENS, true);

    // Attach hook to token
    await token.setTransferHook(await hook.getAddress());
    await controller.setComplianceHook(await hook.getAddress());
  });

  // =========================================================================
  // CATEGORY 1: BrokerCorridorGateway Verification
  // =========================================================================
  describe("1. BrokerCorridorGateway QA", () => {
    it("1.1 Should correctly identify allowlisted wallets via IAllowlistRegistry interface", async () => {
      expect(await gateway.isAllowlist(innovestX_1.address)).to.be.true;
      expect(await gateway.isAllowlist(dime_1.address)).to.be.true;
      expect(await gateway.isAllowlist(unregistered.address)).to.be.false;
    });

    it("1.2 Should enforce role access control for wallet registration and corridor settings", async () => {
      await expect(
        gateway.connect(innovestX_1).registerWallet(unregistered.address, BROKER_INNOVESTX)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(
        gateway.connect(innovestX_1).setCorridor(BROKER_INNOVESTX, BROKER_DIME, true)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("1.3 Should enforce non-transitivity of corridors (A<->B + B<->C does NOT open A<->C)", async () => {
      await gateway.connect(admin).setCorridor(BROKER_INNOVESTX, BROKER_DIME, true);
      await gateway.connect(admin).setCorridor(BROKER_DIME, BROKER_THIRD, true);

      expect(await gateway.isTransferAllowed(innovestX_1.address, dime_1.address)).to.be.true;
      expect(await gateway.isTransferAllowed(dime_1.address, thirdBroker_1.address)).to.be.true;

      expect(await gateway.isTransferAllowed(innovestX_1.address, thirdBroker_1.address)).to.be.false;
      await expect(gateway.checkTransfer(innovestX_1.address, thirdBroker_1.address))
        .to.be.revertedWithCustomError(gateway, "CrossBrokerTransferNotAllowed");
    });

    it("1.4 Should support global unlock override", async () => {
      expect(await gateway.isTransferAllowed(innovestX_1.address, dime_1.address)).to.be.false;

      await gateway.setGlobalUnlock(true);
      expect(await gateway.isTransferAllowed(innovestX_1.address, dime_1.address)).to.be.true;

      expect(await gateway.isTransferAllowed(innovestX_1.address, unregistered.address)).to.be.false;
    });
  });

  // =========================================================================
  // CATEGORY 2: InvestmentTokenM & FundComplianceHook Verification
  // =========================================================================
  describe("2. InvestmentTokenM & Compliance Hook QA", () => {
    beforeEach(async () => {
      await token.mint(ONE_THOUSAND_TOKENS);
      await token.approve(await controller.getAddress(), ONE_HUNDRED_TOKENS);
      await controller.fundBrokerReserve(BROKER_INNOVESTX, ONE_HUNDRED_TOKENS);
      await controller.connect(allotmentAdmin).allotShares(
        innovestX_1.address,
        ONE_HUNDRED_TOKENS,
        ethers.id("QA-HOOK-ALLOTMENT")
      );
    });

    it("2.1 Should allow same-broker transfer (InnovestX #1 -> InnovestX #2)", async () => {
      await expect(token.connect(innovestX_1).transfer(innovestX_2.address, TWENTY_TOKENS))
        .to.emit(token, "Transfer");

      expect(await token.balanceOf(innovestX_2.address)).to.equal(TWENTY_TOKENS);
      expect(await token.balanceOf(innovestX_1.address)).to.equal(ethers.parseEther("80"));
    });

    it("2.2 Should block cross-broker transfer when corridor closed", async () => {
      await expect(token.connect(innovestX_1).transfer(dime_1.address, TWENTY_TOKENS))
        .to.be.revertedWithCustomError(gateway, "CrossBrokerTransferNotAllowed");
    });

    it("2.3 Should enforce minimum 10 tMMF holding balance on sender and recipient", async () => {
      await gateway.connect(admin).setCorridor(BROKER_INNOVESTX, BROKER_DIME, true);

      await expect(token.connect(innovestX_1).transfer(dime_1.address, FIVE_TOKENS))
        .to.be.revertedWithCustomError(hook, "MinimumHoldingRequired")
        .withArgs(dime_1.address, FIVE_TOKENS);

      await expect(token.connect(innovestX_1).transfer(dime_1.address, ethers.parseEther("95")))
        .to.be.revertedWithCustomError(hook, "MinimumHoldingRequired")
        .withArgs(innovestX_1.address, FIVE_TOKENS);

      await expect(token.connect(innovestX_1).transfer(dime_1.address, ONE_HUNDRED_TOKENS))
        .to.emit(token, "Transfer");

      expect(await token.balanceOf(innovestX_1.address)).to.equal(0);
      expect(await token.balanceOf(dime_1.address)).to.equal(ONE_HUNDRED_TOKENS);
    });

    it("2.4 Should operate normally if transfer hook is set to address(0)", async () => {
      await token.setTransferHook(ethers.ZeroAddress);

      await expect(token.connect(innovestX_1).transfer(dime_1.address, FIVE_TOKENS))
        .to.emit(token, "Transfer");
    });
  });

  // =========================================================================
  // CATEGORY 3: FundController Core QA
  // =========================================================================
  describe("3. FundController Core QA", () => {
    beforeEach(async () => {
      await token.mint(ONE_THOUSAND_TOKENS);
      await token.approve(await controller.getAddress(), ONE_THOUSAND_TOKENS);
      await controller.fundBrokerReserve(BROKER_INNOVESTX, ethers.parseEther("500"));
      await controller.fundBrokerReserve(BROKER_DIME, ethers.parseEther("500"));
    });

    it("3.1 Should execute first-time subscription allotment and update per-broker ledgers", async () => {
      const subId = ethers.id("QA-SUB-301");

      await expect(controller.connect(allotmentAdmin).allotShares(innovestX_1.address, FIFTEEN_TOKENS, subId))
        .to.emit(token, "Transfer")
        .withArgs(await controller.getAddress(), innovestX_1.address, FIFTEEN_TOKENS);

      expect(await token.balanceOf(innovestX_1.address)).to.equal(FIFTEEN_TOKENS);
      expect(await controller.totalSharesByBroker(BROKER_INNOVESTX)).to.equal(FIFTEEN_TOKENS);

      await expect(controller.connect(allotmentAdmin).allotShares(innovestX_1.address, FIFTEEN_TOKENS, subId))
        .to.be.revertedWithCustomError(controller, "RefIdAlreadyUsed");
    });

    it("3.2 Should reject allotment to unregistered wallets", async () => {
      const subId = ethers.id("QA-SUB-UNREG-302");
      await expect(
        controller.connect(allotmentAdmin).allotShares(unregistered.address, FIFTEEN_TOKENS, subId)
      ).to.be.revertedWithCustomError(controller, "WalletNotRegisteredInBrokerRegistry");
    });

    it("3.3 Should execute daily NAV growth calculation and push distribution accurately", async () => {
      await controller.connect(allotmentAdmin).allotShares(innovestX_1.address, ONE_HUNDRED_TOKENS, ethers.id("S-303A"));
      await controller.connect(allotmentAdmin).allotShares(dime_1.address, ONE_HUNDRED_TOKENS, ethers.id("S-303B"));

      const totalBaseline = ONE_HUNDRED_TOKENS + ONE_HUNDRED_TOKENS;
      await controller.connect(navUpdater).setBaselineNav(totalBaseline);

      const cycleId = 901;
      const newNav = totalBaseline + TWENTY_TOKENS;
      const snapshotBlock = await ethers.provider.getBlockNumber();
      await expect(controller.connect(navUpdater).updateNav(cycleId, newNav, snapshotBlock, REPORT_HASH))
        .to.emit(controller, "NavUpdated")
        .withArgs(cycleId, totalBaseline, newNav, 1_000_000_000n, snapshotBlock, REPORT_HASH, navUpdater.address);

      const cycleInfo = await controller.cycles(cycleId);
      expect(cycleInfo.diffPercentScaled).to.equal(1_000_000_000n);
      expect(cycleInfo.snapshotBlock).to.equal(snapshotBlock);
      expect(cycleInfo.reportHash).to.equal(REPORT_HASH);

      await expect(controller.connect(distributor).distributeToWallet(innovestX_1.address, cycleId, ONE_HUNDRED_TOKENS))
        .to.emit(token, "Transfer")
        .withArgs(await controller.getAddress(), innovestX_1.address, TEN_TOKENS);

      expect(await token.balanceOf(innovestX_1.address)).to.equal(ONE_HUNDRED_TOKENS + TEN_TOKENS);

      await expect(controller.connect(distributor).distributeToWallet(innovestX_1.address, cycleId, ONE_HUNDRED_TOKENS))
        .to.be.revertedWithCustomError(controller, "AlreadyDistributed");
    });

    it("3.4 Should revert NAV oracle update if NAV decreases", async () => {
      await controller.connect(navUpdater).setBaselineNav(ONE_HUNDRED_TOKENS);

      await expect(
        controller.connect(navUpdater).updateNav(
          902,
          FIVE_TOKENS,
          await ethers.provider.getBlockNumber(),
          REPORT_HASH
        )
      ).to.be.revertedWithCustomError(controller, "NavCannotDecreaseViaOracle");
    });

    it("3.5 Should support batch allotments and distributions", async () => {
      await controller.connect(allotmentAdmin).allotSharesBatch(
        [innovestX_1.address, dime_1.address],
        [FIFTEEN_TOKENS, FIFTEEN_TOKENS],
        [ethers.id("BATCH-305A"), ethers.id("BATCH-305B")]
      );

      expect(await token.balanceOf(innovestX_1.address)).to.equal(FIFTEEN_TOKENS);
      expect(await token.balanceOf(dime_1.address)).to.equal(FIFTEEN_TOKENS);

      const totalBaseline = TWENTY_TOKENS + TWENTY_TOKENS;
      await controller.connect(navUpdater).setBaselineNav(totalBaseline);

      const cycleId = 903;
      await controller.connect(navUpdater).updateNav(
        cycleId,
        totalBaseline + ethers.parseEther("8"),
        await ethers.provider.getBlockNumber(),
        REPORT_HASH
      );

      await controller.connect(distributor).distributeToWallets(
        [innovestX_1.address, dime_1.address],
        cycleId,
        [FIFTEEN_TOKENS, FIFTEEN_TOKENS]
      );

      expect(await token.balanceOf(innovestX_1.address)).to.equal(ethers.parseEther("18"));
      expect(await token.balanceOf(dime_1.address)).to.equal(ethers.parseEther("18"));
    });

    it("3.6 Should sweep only explicitly funded unallocated reserve", async () => {
      const controllerAddr = await controller.getAddress();
      const brokerReserveBefore = await token.balanceOf(controllerAddr);

      await token.mint(ONE_HUNDRED_TOKENS);
      await token.approve(controllerAddr, ONE_HUNDRED_TOKENS);
      await controller.fundReserve(ONE_HUNDRED_TOKENS);

      await expect(controller.connect(admin).sweepReserve(ONE_HUNDRED_TOKENS + 1n, admin.address))
        .to.be.revertedWithCustomError(controller, "InsufficientReserve")
        .withArgs(ONE_HUNDRED_TOKENS + 1n, ONE_HUNDRED_TOKENS);

      await controller.connect(admin).sweepReserve(ONE_HUNDRED_TOKENS, admin.address);
      expect(await controller.unallocatedReserve()).to.equal(0);
      expect(await token.balanceOf(controllerAddr)).to.equal(brokerReserveBefore);
      expect(await controller.brokerReserve(BROKER_INNOVESTX)).to.equal(ethers.parseEther("500"));
      expect(await controller.brokerReserve(BROKER_DIME)).to.equal(ethers.parseEther("500"));
    });

    it("3.7 Should handle redemption request and T+1 broker burn", async () => {
      // 1. Allot shares to InnovestX investor (100 tMMF)
      const subId = ethers.id("QA-SUB-307");
      await controller.connect(allotmentAdmin).allotShares(innovestX_1.address, ONE_HUNDRED_TOKENS, subId);
      expect(await controller.totalSharesByBroker(BROKER_INNOVESTX)).to.equal(ONE_HUNDRED_TOKENS);

      // Investor approves controller to pull 40 tMMF for redemption
      await token.connect(innovestX_1).approve(await controller.getAddress(), ethers.parseEther("40"));

      // 2. Request Redeem 40 tMMF
      const redeemReqId = ethers.id("REDEEM-REQ-001");
      await expect(controller.connect(allotmentAdmin).requestRedeem(innovestX_1.address, ethers.parseEther("40"), redeemReqId))
        .to.emit(controller, "RedeemRequested")
        .withArgs(innovestX_1.address, BROKER_INNOVESTX, ethers.parseEther("40"), redeemReqId);

      // Check balances & locked total
      expect(await token.balanceOf(innovestX_1.address)).to.equal(ethers.parseEther("60"));
      expect(await controller.totalSharesByBroker(BROKER_INNOVESTX)).to.equal(ethers.parseEther("60"));
      expect(await controller.lockedForRedemption(BROKER_INNOVESTX)).to.equal(ethers.parseEther("40"));

      await expect(controller.connect(admin).sweepReserve(1, admin.address))
        .to.be.revertedWithCustomError(controller, "InsufficientReserve")
        .withArgs(1, 0);

      // 3. T+1 Settlement Burn by SCBAM admin
      const totalSupplyBefore = await token.totalSupply();
      await expect(controller.connect(admin).settleRedemptions([redeemReqId]))
        .to.emit(controller, "RedemptionsSettled")
        .withArgs([redeemReqId], ethers.parseEther("40"), admin.address);

      expect(await controller.lockedForRedemption(BROKER_INNOVESTX)).to.equal(0);
      expect(await token.totalSupply()).to.equal(totalSupplyBefore - ethers.parseEther("40"));
    });

    it("3.8 Should enforce isolated per-broker reserve quotas via fundBrokerReserve", async () => {
      await controller.sweepBrokerReserve(BROKER_INNOVESTX, ethers.parseEther("500"), admin.address);

      // Admin mints 500 tMMF and funds isolated reserve specifically for InnovestX (40 tMMF)
      const fiveHundred = ethers.parseEther("500");
      await token.mint(fiveHundred);
      await token.approve(await controller.getAddress(), fiveHundred);

      await expect(controller.fundBrokerReserve(BROKER_INNOVESTX, TWENTY_TOKENS + TWENTY_TOKENS)) // 40 tMMF
        .to.emit(controller, "BrokerReserveFunded")
        .withArgs(BROKER_INNOVESTX, admin.address, TWENTY_TOKENS + TWENTY_TOKENS);

      expect(await controller.brokerReserve(BROKER_INNOVESTX)).to.equal(TWENTY_TOKENS + TWENTY_TOKENS);

      // Allot 30 tMMF to InnovestX investor (succeeds, deducts from brokerReserve[InnovestX])
      await controller.connect(allotmentAdmin).allotShares(innovestX_1.address, ethers.parseEther("30"), ethers.id("SUB-ISOLATED-1"));
      expect(await controller.brokerReserve(BROKER_INNOVESTX)).to.equal(TEN_TOKENS); // 40 - 30 = 10 remaining

      // Attempting to allot 20 tMMF to InnovestX investor fails because isolated broker reserve only has 10 tMMF left
      await expect(
        controller.connect(allotmentAdmin).allotShares(innovestX_1.address, TWENTY_TOKENS, ethers.id("SUB-ISOLATED-2"))
      ).to.be.revertedWithCustomError(controller, "InsufficientReserve")
        .withArgs(TWENTY_TOKENS, TEN_TOKENS);
    });

    it("3.9 Should not use another broker reserve when NAV distribution broker reserve is zero", async () => {
      await controller.connect(allotmentAdmin).allotShares(
        innovestX_1.address,
        ONE_HUNDRED_TOKENS,
        ethers.id("NAV-ISOLATED-ALLOTMENT")
      );
      await controller.sweepBrokerReserve(BROKER_INNOVESTX, ethers.parseEther("400"), admin.address);

      await controller.connect(navUpdater).setBaselineNav(ONE_HUNDRED_TOKENS);
      await controller.connect(navUpdater).updateNav(
        904,
        ethers.parseEther("110"),
        await ethers.provider.getBlockNumber(),
        REPORT_HASH
      );

      expect(await controller.brokerReserve(BROKER_INNOVESTX)).to.equal(0);
      expect(await controller.brokerReserve(BROKER_DIME)).to.equal(ethers.parseEther("500"));
      await expect(controller.connect(distributor).distributeToWallet(innovestX_1.address, 904, ONE_HUNDRED_TOKENS))
        .to.be.revertedWithCustomError(controller, "InsufficientReserve")
        .withArgs(TEN_TOKENS, 0);
    });

    it("3.10 Should not account raw token transfers as spendable reserve", async () => {
      const controllerAddress = await controller.getAddress();
      await controller.sweepBrokerReserve(BROKER_INNOVESTX, ethers.parseEther("500"), admin.address);
      await token.transfer(controllerAddress, TEN_TOKENS);

      expect(await token.balanceOf(controllerAddress)).to.equal(ethers.parseEther("510"));
      expect(await controller.unallocatedReserve()).to.equal(0);
      expect(await controller.brokerReserve(BROKER_INNOVESTX)).to.equal(0);

      await expect(controller.sweepReserve(TEN_TOKENS, admin.address))
        .to.be.revertedWithCustomError(controller, "InsufficientReserve")
        .withArgs(TEN_TOKENS, 0);
      await expect(
        controller.connect(allotmentAdmin).allotShares(
          innovestX_1.address,
          TEN_TOKENS,
          ethers.id("RAW-TRANSFER-NOT-RESERVE")
        )
      ).to.be.revertedWithCustomError(controller, "InsufficientReserve")
        .withArgs(TEN_TOKENS, 0);
    });

    it("3.11 Should reject invalid snapshot metadata atomically and prevent cycle replacement", async () => {
      await controller.connect(navUpdater).setBaselineNav(ONE_HUNDRED_TOKENS);
      const currentBlock = await ethers.provider.getBlockNumber();

      await expect(
        controller.connect(navUpdater).updateNav(905, ethers.parseEther("110"), 0, REPORT_HASH)
      ).to.be.revertedWithCustomError(controller, "ZeroSnapshotBlock");
      expect(await controller.latestNav()).to.equal(ONE_HUNDRED_TOKENS);
      expect((await controller.cycles(905)).set).to.be.false;

      await expect(
        controller.connect(navUpdater).updateNav(905, ethers.parseEther("110"), currentBlock + 100, REPORT_HASH)
      ).to.be.revertedWithCustomError(controller, "SnapshotBlockInFuture");
      expect(await controller.latestNav()).to.equal(ONE_HUNDRED_TOKENS);
      expect((await controller.cycles(905)).set).to.be.false;

      await expect(
        controller.connect(navUpdater).updateNav(905, ethers.parseEther("110"), currentBlock, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(controller, "ZeroReportHash");
      expect(await controller.latestNav()).to.equal(ONE_HUNDRED_TOKENS);
      expect((await controller.cycles(905)).set).to.be.false;

      await controller.connect(navUpdater).updateNav(905, ethers.parseEther("110"), currentBlock, REPORT_HASH);
      await expect(
        controller.connect(navUpdater).updateNav(905, ethers.parseEther("120"), currentBlock, ethers.id("replacement.csv"))
      ).to.be.revertedWithCustomError(controller, "CycleAlreadySet");

      await expect(
        controller.connect(navUpdater).updateNav(908, ethers.parseEther("120"), currentBlock - 1, ethers.id("older-snapshot.csv"))
      ).to.be.revertedWithCustomError(controller, "SnapshotBlockOutOfOrder")
        .withArgs(currentBlock - 1, currentBlock);
    });

    it("3.12 Should require distributor authorization and registration even for zero entitlement", async () => {
      await controller.connect(navUpdater).setBaselineNav(ONE_HUNDRED_TOKENS);
      const cycleId = 906;
      await controller.connect(navUpdater).updateNav(
        cycleId,
        ONE_HUNDRED_TOKENS,
        await ethers.provider.getBlockNumber(),
        REPORT_HASH
      );

      await expect(
        controller.connect(innovestX_1).distributeToWallet(innovestX_1.address, cycleId, 0)
      ).to.be.revertedWith(/AccessControl/);
      await expect(
        controller.connect(distributor).distributeToWallet(unregistered.address, cycleId, 0)
      ).to.be.revertedWithCustomError(controller, "WalletNotRegisteredInBrokerRegistry");

      const processedKey = ethers.solidityPackedKeccak256(
        ["address", "uint256"],
        [unregistered.address, cycleId]
      );
      expect(await controller.processed(processedKey)).to.be.false;

      const registeredKey = ethers.solidityPackedKeccak256(
        ["address", "uint256"],
        [innovestX_1.address, cycleId]
      );
      await expect(controller.connect(distributor).distributeToWallet(innovestX_1.address, cycleId, 0))
        .to.emit(controller, "Distributed")
        .withArgs(innovestX_1.address, cycleId, 0, 0);
      expect(await controller.processed(registeredKey)).to.be.true;
      await expect(controller.connect(distributor).distributeToWallet(innovestX_1.address, cycleId, TEN_TOKENS))
        .to.be.revertedWithCustomError(controller, "AlreadyDistributed");
    });

    it("3.13 Should floor report-balance entitlement and reject mismatched batches", async () => {
      await controller.connect(navUpdater).setBaselineNav(ethers.parseEther("3"));
      const cycleId = 907;
      await controller.connect(navUpdater).updateNav(
        cycleId,
        ethers.parseEther("4"),
        await ethers.provider.getBlockNumber(),
        REPORT_HASH
      );

      const expectedFloor = (TEN_TOKENS * 3_333_333_333n) / 10_000_000_000n;
      expect(await controller.previewDistribution(TEN_TOKENS, cycleId)).to.equal(expectedFloor);
      await expect(
        controller.connect(distributor).distributeToWallet(innovestX_1.address, cycleId, TEN_TOKENS)
      ).to.emit(controller, "Distributed")
        .withArgs(innovestX_1.address, cycleId, TEN_TOKENS, expectedFloor);

      await expect(
        controller.connect(distributor).distributeToWallets([dime_1.address], cycleId, [])
      ).to.be.revertedWithCustomError(controller, "ArrayLengthMismatch");
    });
  });
});
