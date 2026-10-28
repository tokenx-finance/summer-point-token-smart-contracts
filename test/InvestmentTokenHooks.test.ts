import { expect } from "chai";
import { ethers } from "hardhat";

describe("InvestmentTokenM Transfer Hooks & Integration", () => {
  let token: any;
  let registry: any;
  let gateway: any;
  let controller: any;
  let hook: any;

  let owner: any;
  let distributor: any;
  let walletA: any;
  let walletB: any;
  let walletC: any;
  let unregisteredWallet: any;

  const BROKER_INNOVESTX = ethers.keccak256(ethers.toUtf8Bytes("InnovestX"));
  const BROKER_DIME = ethers.keccak256(ethers.toUtf8Bytes("Dime"));

  const TEN_TOKENS = ethers.parseEther("10");
  const FIVE_TOKENS = ethers.parseEther("5");
  const FIFTEEN_TOKENS = ethers.parseEther("15");
  const TWENTY_TOKENS = ethers.parseEther("20");
  const FIFTY_TOKENS = ethers.parseEther("50");
  const ONE_HUNDRED_TOKENS = ethers.parseEther("100");

  beforeEach(async () => {
    [owner, distributor, walletA, walletB, walletC, unregisteredWallet] = await ethers.getSigners();

    // 1. Deploy AllowlistRegistry and allowlist all participants
    const Registry = await ethers.getContractFactory("AllowlistRegistry");
    registry = await Registry.deploy();
    await registry.addAllowlist(owner.address);
    await registry.addAllowlist(distributor.address);
    await registry.addAllowlist(walletA.address);
    await registry.addAllowlist(walletB.address);
    await registry.addAllowlist(walletC.address);

    // 2. Deploy InvestmentTokenM
    const Token = await ethers.getContractFactory("InvestmentTokenM");
    token = await Token.deploy("Tokenized MMF", "tMMF", await registry.getAddress());

    // 3. Deploy AllowlistRegistryProxyV2
    const Gateway = await ethers.getContractFactory("AllowlistRegistryProxyV2");
    gateway = await Gateway.deploy("Multi-Broker Allowlist Proxy");

    await gateway.registerWallet(walletA.address, BROKER_INNOVESTX);
    await gateway.registerWallet(walletB.address, BROKER_INNOVESTX);
    await gateway.registerWallet(walletC.address, BROKER_DIME);

    // 4. Deploy FundController
    const Controller = await ethers.getContractFactory("FundController");
    controller = await Controller.deploy(await token.getAddress(), owner.address);
    await controller.setBrokerRegistry(await gateway.getAddress());

    await registry.addAllowlist(await controller.getAddress());

    const ALLOTMENT_ROLE = await controller.ALLOTMENT_ROLE();
    const DISTRIBUTOR_ROLE = await controller.DISTRIBUTOR_ROLE();
    const NAV_UPDATER_ROLE = await controller.NAV_UPDATER_ROLE();
    await controller.grantRole(ALLOTMENT_ROLE, owner.address);
    await controller.grantRole(DISTRIBUTOR_ROLE, distributor.address);
    await controller.grantRole(NAV_UPDATER_ROLE, owner.address);

    // 5. Deploy FundComplianceHook (Uniswap v4 style lifecycle hook)
    const Hook = await ethers.getContractFactory("FundComplianceHook");
    hook = await Hook.deploy(
      await token.getAddress(),
      await gateway.getAddress(),
      await controller.getAddress()
    );

    // Wire controller and token to the compliance hook
    await controller.setComplianceHook(await hook.getAddress());
    await token.setTransferHook(await hook.getAddress());
  });

  describe("Configuration & Setters", () => {
    it("Should allow owner to configure hook and token transfer hook", async () => {
      expect(await token.transferHook()).to.equal(await hook.getAddress());
      expect(await controller.complianceHook()).to.equal(await hook.getAddress());

      await hook.setMinHoldingConfig(TEN_TOKENS, true);
      expect(await hook.minHoldingAmount()).to.equal(TEN_TOKENS);
      expect(await hook.minHoldingCheckEnabled()).to.be.true;
    });

    it("Should revert configuration setters when caller is not owner", async () => {
      await expect(token.connect(walletA).setTransferHook(walletA.address))
        .to.be.revertedWith("Ownable: caller is not the owner");
      await expect(hook.connect(walletA).setMinHoldingConfig(TEN_TOKENS, true))
        .to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should reject zero and EOA controller configuration without changing existing values", async () => {
      const gatewayAddress = await gateway.getAddress();
      const hookAddress = await hook.getAddress();

      await expect(controller.setBrokerRegistry(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(controller, "InvalidBrokerRegistry")
        .withArgs(ethers.ZeroAddress);
      await expect(controller.setBrokerRegistry(walletA.address))
        .to.be.revertedWithCustomError(controller, "InvalidBrokerRegistry")
        .withArgs(walletA.address);
      expect(await controller.brokerRegistry()).to.equal(gatewayAddress);

      await expect(controller.setComplianceHook(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(controller, "InvalidComplianceHook")
        .withArgs(ethers.ZeroAddress);
      await expect(controller.setComplianceHook(walletA.address))
        .to.be.revertedWithCustomError(controller, "InvalidComplianceHook")
        .withArgs(walletA.address);
      expect(await controller.complianceHook()).to.equal(hookAddress);
    });
  });

  describe("FundController Broker Ledger Synchronization", () => {
    it("Should reject synchronization when no compliance hook is configured", async () => {
      const Controller = await ethers.getContractFactory("FundController");
      const unconfiguredController = await Controller.deploy(await token.getAddress(), owner.address);

      await expect(
        unconfiguredController.connect(walletA).syncBrokerShares(BROKER_INNOVESTX, BROKER_DIME, FIVE_TOKENS)
      ).to.be.revertedWithCustomError(unconfiguredController, "OnlyComplianceHook");
      await expect(
        unconfiguredController.connect(walletA).syncBrokerShares(BROKER_INNOVESTX, BROKER_DIME, 0)
      ).to.be.revertedWithCustomError(unconfiguredController, "OnlyComplianceHook");
      await expect(
        unconfiguredController.connect(walletA).syncBrokerShares(BROKER_INNOVESTX, BROKER_INNOVESTX, FIVE_TOKENS)
      ).to.be.revertedWithCustomError(unconfiguredController, "OnlyComplianceHook");
      expect(await unconfiguredController.totalSharesByBroker(BROKER_INNOVESTX)).to.equal(0);
      expect(await unconfiguredController.totalSharesByBroker(BROKER_DIME)).to.equal(0);
    });

    it("Should reject synchronization from any caller other than the configured hook", async () => {
      await expect(
        controller.connect(walletA).syncBrokerShares(BROKER_INNOVESTX, BROKER_DIME, FIVE_TOKENS)
      ).to.be.revertedWithCustomError(controller, "OnlyComplianceHook");
      await expect(
        controller.connect(walletA).syncBrokerShares(BROKER_INNOVESTX, BROKER_DIME, 0)
      ).to.be.revertedWithCustomError(controller, "OnlyComplianceHook");
      await expect(
        controller.connect(walletA).syncBrokerShares(BROKER_INNOVESTX, BROKER_INNOVESTX, FIVE_TOKENS)
      ).to.be.revertedWithCustomError(controller, "OnlyComplianceHook");
      expect(await controller.totalSharesByBroker(BROKER_INNOVESTX)).to.equal(0);
      expect(await controller.totalSharesByBroker(BROKER_DIME)).to.equal(0);
    });

    it("Should reject a hook movement that exceeds the source broker ledger", async () => {
      await gateway.setCorridor(BROKER_INNOVESTX, BROKER_DIME, true);
      await token.mint(ONE_HUNDRED_TOKENS);
      await token.approve(await controller.getAddress(), FIFTEEN_TOKENS);
      await controller.fundBrokerReserve(BROKER_INNOVESTX, FIFTEEN_TOKENS);
      await controller.allotShares(walletA.address, FIFTEEN_TOKENS, ethers.id("ledger-source"));
      await token.transfer(walletA.address, TWENTY_TOKENS);

      await expect(token.connect(walletA).transfer(walletC.address, TWENTY_TOKENS))
        .to.be.revertedWithCustomError(controller, "InsufficientBrokerShares")
        .withArgs(BROKER_INNOVESTX, TWENTY_TOKENS, FIFTEEN_TOKENS);

      expect(await token.balanceOf(walletA.address)).to.equal(FIFTEEN_TOKENS + TWENTY_TOKENS);
      expect(await token.balanceOf(walletC.address)).to.equal(0);
      expect(await controller.totalSharesByBroker(BROKER_INNOVESTX)).to.equal(FIFTEEN_TOKENS);
      expect(await controller.totalSharesByBroker(BROKER_DIME)).to.equal(0);
    });
  });

  describe("Corridor Gateway Hook via Transfer Hook", () => {
    beforeEach(async () => {
      await token.mint(ONE_HUNDRED_TOKENS);
      await token.approve(await controller.getAddress(), TWENTY_TOKENS + TEN_TOKENS);
      await controller.fundBrokerReserve(BROKER_INNOVESTX, FIFTEEN_TOKENS);
      await controller.fundBrokerReserve(BROKER_DIME, FIFTEEN_TOKENS);
      await controller.allotShares(walletA.address, FIFTEEN_TOKENS, ethers.id("corridor-wallet-a"));
      await controller.allotShares(walletC.address, FIFTEEN_TOKENS, ethers.id("corridor-wallet-c"));
    });

    it("Should allow same-broker transfer regardless of corridor state", async () => {
      await expect(token.connect(walletA).transfer(walletB.address, TEN_TOKENS))
        .to.emit(token, "Transfer");
      expect(await token.balanceOf(walletB.address)).to.equal(TEN_TOKENS);
    });

    it("Should revert cross-broker transfer when corridor is not open", async () => {
      await expect(token.connect(walletA).transfer(walletC.address, FIVE_TOKENS))
        .to.be.revertedWithCustomError(gateway, "CrossBrokerTransferNotAllowed");
    });

    it("Should allow cross-broker transfer once corridor is opened", async () => {
      await gateway.setCorridor(BROKER_INNOVESTX, BROKER_DIME, true);
      await expect(token.connect(walletA).transfer(walletC.address, FIVE_TOKENS))
        .to.emit(controller, "BrokerSharesSynced")
        .withArgs(BROKER_INNOVESTX, BROKER_DIME, FIVE_TOKENS);
      expect(await controller.totalSharesByBroker(BROKER_INNOVESTX)).to.equal(TEN_TOKENS);
      expect(await controller.totalSharesByBroker(BROKER_DIME)).to.equal(TWENTY_TOKENS);
      expect(await controller.totalShares()).to.equal(TWENTY_TOKENS + TEN_TOKENS);
    });

    it("Should revert transfer involving an unregistered wallet", async () => {
      await registry.addAllowlist(unregisteredWallet.address);
      await expect(token.connect(walletA).transfer(unregisteredWallet.address, FIVE_TOKENS))
        .to.be.revertedWithCustomError(gateway, "WalletNotRegistered");
    });

    it("Should allow cross-broker transfer when global unlock is enabled", async () => {
      await gateway.setGlobalUnlock(true);
      await expect(token.connect(walletA).transfer(walletC.address, FIVE_TOKENS))
        .to.emit(controller, "BrokerSharesSynced")
        .withArgs(BROKER_INNOVESTX, BROKER_DIME, FIVE_TOKENS);
    });
  });

  describe("Minimum Holding Requirement Hook via Transfer Hook", () => {
    beforeEach(async () => {
      await hook.setMinHoldingConfig(TEN_TOKENS, true);
      await gateway.setGlobalUnlock(true);
      await token.mint(ONE_HUNDRED_TOKENS);
      await token.transfer(walletA.address, FIFTEEN_TOKENS);
    });

    it("Should revert transfer if sender remaining balance is strictly between 0 and 10 tMMF", async () => {
      await expect(token.connect(walletA).transfer(walletB.address, TEN_TOKENS))
        .to.be.revertedWithCustomError(hook, "MinimumHoldingRequired")
        .withArgs(walletA.address, FIVE_TOKENS);
    });

    it("Should revert transfer if recipient resulting balance is strictly between 0 and 10 tMMF", async () => {
      await expect(token.connect(walletA).transfer(walletB.address, FIVE_TOKENS))
        .to.be.revertedWithCustomError(hook, "MinimumHoldingRequired")
        .withArgs(walletB.address, FIVE_TOKENS);
    });

    it("Should allow transfer when sender exits completely (0 balance)", async () => {
      await expect(token.connect(walletA).transfer(walletB.address, FIFTEEN_TOKENS))
        .to.emit(token, "Transfer");

      expect(await token.balanceOf(walletA.address)).to.equal(0);
      expect(await token.balanceOf(walletB.address)).to.equal(FIFTEEN_TOKENS);
    });

    it("Should allow transfer when post-transfer balances for both are >= 10 tMMF", async () => {
      await token.mint(TWENTY_TOKENS);
      await token.transfer(walletA.address, TWENTY_TOKENS);

      await expect(token.connect(walletA).transfer(walletB.address, FIFTEEN_TOKENS))
        .to.emit(token, "Transfer");

      expect(await token.balanceOf(walletA.address)).to.equal(TWENTY_TOKENS);
      expect(await token.balanceOf(walletB.address)).to.equal(FIFTEEN_TOKENS);
    });
  });

  describe("FundController Integration & Bypass", () => {
    beforeEach(async () => {
      await hook.setMinHoldingConfig(TEN_TOKENS, true);
      await token.mint(ONE_HUNDRED_TOKENS);
      await token.approve(await controller.getAddress(), ONE_HUNDRED_TOKENS);
      await controller.fundBrokerReserve(BROKER_INNOVESTX, FIFTY_TOKENS);
      await controller.fundBrokerReserve(BROKER_DIME, FIFTY_TOKENS);
    });

    it("Should bypass corridor and min holding rules during controller allotment", async () => {
      await expect(controller.allotShares(walletA.address, FIVE_TOKENS, ethers.id("sub-1")))
        .to.emit(token, "Transfer");

      expect(await token.balanceOf(walletA.address)).to.equal(FIVE_TOKENS);
    });

    it("Should bypass corridor and min holding rules during daily NAV distribution", async () => {
      await controller.allotShares(walletA.address, TEN_TOKENS, ethers.id("sub-1"));
      await controller.allotShares(walletC.address, TEN_TOKENS, ethers.id("sub-2"));

      await controller.setBaselineNav(TWENTY_TOKENS);
      await controller.updateNav(
        1,
        TWENTY_TOKENS + TEN_TOKENS,
        await ethers.provider.getBlockNumber(),
        ethers.id("snapshot-hook-integration.csv")
      );

      await expect(controller.connect(distributor).distributeToWallet(walletA.address, 1, TEN_TOKENS))
        .to.emit(token, "Transfer");

      expect(await token.balanceOf(walletA.address)).to.equal(FIFTEEN_TOKENS);
    });
  });
});
