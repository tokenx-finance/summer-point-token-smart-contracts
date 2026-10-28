import { expect } from "chai";
import { ethers } from "hardhat";
import {
  AllowlistRegistryProxyV2,
  AllowlistRegistry,
  InvestmentTokenM,
  FundComplianceHook,
  FundController
} from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("AllowlistRegistryProxyV2 (v2.0.0) - Audited Upgrade QA", () => {
  let owner: HardhatEthersSigner;
  let innovestXAdmin: HardhatEthersSigner;
  let dimeAdmin: HardhatEthersSigner;
  let investorA: HardhatEthersSigner;
  let investorB: HardhatEthersSigner;
  let investorC: HardhatEthersSigner;
  let blacklistedUser: HardhatEthersSigner;

  let proxy: AllowlistRegistryProxyV2;
  let childRegistry1: AllowlistRegistry;
  let childRegistry2: AllowlistRegistry;

  const BROKER_INNOVESTX = ethers.keccak256(ethers.toUtf8Bytes("INNOVESTX"));
  const BROKER_DIME = ethers.keccak256(ethers.toUtf8Bytes("DIME"));

  beforeEach(async () => {
    [owner, innovestXAdmin, dimeAdmin, investorA, investorB, investorC, blacklistedUser] = await ethers.getSigners();

    // 1. Deploy AllowlistRegistryProxyV2
    const ProxyFactory = await ethers.getContractFactory("AllowlistRegistryProxyV2");
    proxy = await ProxyFactory.deploy("TokenX Multi-Broker Proxy v2");
    await proxy.waitForDeployment();

    // 2. Deploy 2 Standalone AllowlistRegistries (v1 child registries)
    const AllowlistRegistryFactory = await ethers.getContractFactory("AllowlistRegistry");
    childRegistry1 = await AllowlistRegistryFactory.deploy();
    await childRegistry1.waitForDeployment();

    childRegistry2 = await AllowlistRegistryFactory.deploy();
    await childRegistry2.waitForDeployment();
  });

  describe("V1 Functionality: Multi-Registry Aggregation & Blacklist", () => {
    it("1.1 Should return correct version (2.0.0) and proxy name", async () => {
      expect(await proxy.version()).to.equal("2.0.0");
      expect(await proxy.name()).to.equal("TokenX Multi-Broker Proxy v2");
    });

    it("1.2 Should add, pause, unpause, and remove child registries", async () => {
      await proxy.addRegistry("INNOVESTX_REGISTRY", await childRegistry1.getAddress());
      expect(await proxy.totalRegistry()).to.equal(1n);

      let [provider, paused] = await proxy.getRegistryInfo(await childRegistry1.getAddress());
      expect(provider).to.equal("INNOVESTX_REGISTRY");
      expect(paused).to.be.false;

      // Pause
      await proxy.pauseRegistry(await childRegistry1.getAddress());
      [, paused] = await proxy.getRegistryInfo(await childRegistry1.getAddress());
      expect(paused).to.be.true;

      // Unpause
      await proxy.unpauseRegistry(await childRegistry1.getAddress());
      [, paused] = await proxy.getRegistryInfo(await childRegistry1.getAddress());
      expect(paused).to.be.false;

      // Remove
      await proxy.removeRegistry(await childRegistry1.getAddress());
      expect(await proxy.totalRegistry()).to.equal(0n);
    });

    it("1.3 Should verify isAllowlist via child registry (V1 fallback mode)", async () => {
      await proxy.addRegistry("INNOVESTX_REGISTRY", await childRegistry1.getAddress());

      // Not allowlisted initially
      expect(await proxy.isAllowlist(investorA.address)).to.be.false;

      // Add to child registry
      await childRegistry1.addAllowlist(investorA.address);
      expect(await proxy.isAllowlist(investorA.address)).to.be.true;

      // If child registry paused, isAllowlist should return false
      await proxy.pauseRegistry(await childRegistry1.getAddress());
      expect(await proxy.isAllowlist(investorA.address)).to.be.false;

      await proxy.unpauseRegistry(await childRegistry1.getAddress());
      expect(await proxy.isAllowlist(investorA.address)).to.be.true;
    });

    it("1.4 Should enforce blacklist override over allowlist", async () => {
      await proxy.addRegistry("INNOVESTX_REGISTRY", await childRegistry1.getAddress());
      await childRegistry1.addAllowlist(blacklistedUser.address);

      expect(await proxy.isAllowlist(blacklistedUser.address)).to.be.true;

      // Blacklist user
      await proxy.addBlacklist(blacklistedUser.address);
      expect(await proxy.isBlacklist(blacklistedUser.address)).to.be.true;
      expect(await proxy.isAllowlist(blacklistedUser.address)).to.be.false;

      // Remove from blacklist
      await proxy.removeBlacklist(blacklistedUser.address);
      expect(await proxy.isBlacklist(blacklistedUser.address)).to.be.false;
      expect(await proxy.isAllowlist(blacklistedUser.address)).to.be.true;
    });

    it("1.5 Should isolate failed and paused child registries", async () => {
      const ControllerFactory = await ethers.getContractFactory("FundController");
      const invalidChild = await ControllerFactory.deploy(await childRegistry1.getAddress(), owner.address);
      await invalidChild.waitForDeployment();

      await proxy.addRegistry("BROKEN", await invalidChild.getAddress());
      await proxy.addRegistry("INNOVESTX_REGISTRY", await childRegistry1.getAddress());
      await childRegistry1.addAllowlist(investorA.address);

      expect(await proxy.walletBroker(investorA.address)).to.equal(
        ethers.keccak256(ethers.toUtf8Bytes("INNOVESTX_REGISTRY"))
      );

      let [, , allowlists] = await proxy.getAccountProviderInfo(investorA.address);
      expect(allowlists).to.deep.equal([false, true]);

      await proxy.pauseRegistry(await childRegistry1.getAddress());
      [, , allowlists] = await proxy.getAccountProviderInfo(investorA.address);
      expect(allowlists).to.deep.equal([false, false]);
    });
  });

  describe("V2 Functionality: Multi-Broker KYC & Pairwise Corridor Gating", () => {
    it("2.1 Should register wallets to brokers and return O(1) isAllowlist", async () => {
      expect(await proxy.walletBroker(investorA.address)).to.equal(ethers.ZeroHash);
      expect(await proxy.isAllowlist(investorA.address)).to.be.false;

      // Register wallet to InnovestX
      await proxy.registerWallet(investorA.address, BROKER_INNOVESTX);
      expect(await proxy.walletBroker(investorA.address)).to.equal(BROKER_INNOVESTX);

      // isAllowlist should immediately return true via V2 O(1) path
      expect(await proxy.isAllowlist(investorA.address)).to.be.true;
    });

    it("2.2 Should batch register wallets", async () => {
      await proxy.registerWalletsBatch(
        [investorA.address, investorB.address],
        [BROKER_INNOVESTX, BROKER_DIME]
      );

      expect(await proxy.walletBroker(investorA.address)).to.equal(BROKER_INNOVESTX);
      expect(await proxy.walletBroker(investorB.address)).to.equal(BROKER_DIME);
    });

    it("2.3 Should allow same-broker transfers freely", async () => {
      await proxy.registerWallet(investorA.address, BROKER_INNOVESTX);
      await proxy.registerWallet(investorB.address, BROKER_INNOVESTX);

      expect(await proxy.isAllowTransfer(investorA.address, investorB.address)).to.be.true;
      await expect(proxy.checkTransfer(investorA.address, investorB.address)).to.not.be.reverted;
    });

    it("2.4 Should gate cross-broker transfers via pairwise corridors", async () => {
      await proxy.registerWallet(investorA.address, BROKER_INNOVESTX);
      await proxy.registerWallet(investorC.address, BROKER_DIME);

      // Corridor closed initially
      expect(await proxy.isAllowTransfer(investorA.address, investorC.address)).to.be.false;
      await expect(proxy.checkTransfer(investorA.address, investorC.address))
        .to.be.revertedWithCustomError(proxy, "CrossBrokerTransferNotAllowed");

      // Open symmetric corridor
      await proxy.setCorridor(BROKER_INNOVESTX, BROKER_DIME, true);
      expect(await proxy.corridorAllowed(BROKER_INNOVESTX, BROKER_DIME)).to.be.true;
      expect(await proxy.corridorAllowed(BROKER_DIME, BROKER_INNOVESTX)).to.be.true;

      expect(await proxy.isAllowTransfer(investorA.address, investorC.address)).to.be.true;
      expect(await proxy.isAllowTransfer(investorC.address, investorA.address)).to.be.true;
      await expect(proxy.checkTransfer(investorA.address, investorC.address)).to.not.be.reverted;
    });

    it("2.5 Should support global corridor unlock switch", async () => {
      await proxy.registerWallet(investorA.address, BROKER_INNOVESTX);
      await proxy.registerWallet(investorC.address, BROKER_DIME);

      // Corridor is closed
      expect(await proxy.isAllowTransfer(investorA.address, investorC.address)).to.be.false;

      // Enable Global Unlock
      await proxy.setGlobalUnlock(true);
      expect(await proxy.crossBrokerTransfersGloballyEnabled()).to.be.true;

      expect(await proxy.isAllowTransfer(investorA.address, investorC.address)).to.be.true;
      await expect(proxy.checkTransfer(investorA.address, investorC.address)).to.not.be.reverted;
    });

    it("2.6 Should reject invalid administration and explicitly unregister wallets", async () => {
      await expect(proxy.registerWallet(ethers.ZeroAddress, BROKER_INNOVESTX))
        .to.be.revertedWithCustomError(proxy, "InvalidWallet");
      await expect(proxy.registerWallet(investorA.address, ethers.ZeroHash))
        .to.be.revertedWithCustomError(proxy, "InvalidBroker");
      await expect(proxy.registerWalletsBatch([investorA.address], []))
        .to.be.revertedWithCustomError(proxy, "ArrayLengthMismatch");
      await expect(proxy.addRegistry("", await childRegistry1.getAddress()))
        .to.be.revertedWithCustomError(proxy, "InvalidProvider");
      await expect(proxy.addRegistry("EOA", investorA.address))
        .to.be.revertedWithCustomError(proxy, "InvalidRegistry");
      await expect(proxy.setCorridor(ethers.ZeroHash, BROKER_DIME, true))
        .to.be.revertedWithCustomError(proxy, "InvalidBroker");

      await proxy.registerWallet(investorA.address, BROKER_INNOVESTX);
      await expect(proxy.unregisterWallet(investorA.address))
        .to.emit(proxy, "WalletUnregistered")
        .withArgs(investorA.address, BROKER_INNOVESTX);
      expect(await proxy.walletBroker(investorA.address)).to.equal(ethers.ZeroHash);
      await expect(proxy.unregisterWallet(investorA.address))
        .to.be.revertedWithCustomError(proxy, "WalletNotRegistered");
    });

    it("2.7 Should keep directional corridors one-way", async () => {
      await proxy.registerWallet(investorA.address, BROKER_INNOVESTX);
      await proxy.registerWallet(investorC.address, BROKER_DIME);
      await proxy.setCorridorDirectional(BROKER_INNOVESTX, BROKER_DIME, true);

      expect(await proxy.isAllowTransfer(investorA.address, investorC.address)).to.be.true;
      expect(await proxy.isAllowTransfer(investorC.address, investorA.address)).to.be.false;
    });
  });

  describe("Integration with InvestmentTokenM, ComplianceHook & FundController", () => {
    let token: InvestmentTokenM;
    let hook: FundComplianceHook;
    let controller: FundController;

    beforeEach(async () => {
      // Deploy InvestmentTokenM with AllowlistRegistryProxy v2
      const TokenFactory = await ethers.getContractFactory("InvestmentTokenM");
      token = await TokenFactory.deploy("SCBAM tMMF", "tMMF", await proxy.getAddress());
      await token.waitForDeployment();

      // Deploy FundController
      const ControllerFactory = await ethers.getContractFactory("FundController");
      controller = await ControllerFactory.deploy(await token.getAddress(), owner.address);
      await controller.waitForDeployment();
      await controller.setBrokerRegistry(await proxy.getAddress());

      // Deploy FundComplianceHook
      const HookFactory = await ethers.getContractFactory("FundComplianceHook");
      hook = await HookFactory.deploy(
        await token.getAddress(),
        await proxy.getAddress(),
        await controller.getAddress()
      );
      await hook.waitForDeployment();
      await hook.setMinHoldingConfig(ethers.parseEther("10"), true);

      // Link contracts
      await token.setTransferHook(await hook.getAddress());
      await controller.setComplianceHook(await hook.getAddress());
    });

    it("3.1 Should execute full token lifecycle with AllowlistRegistryProxy v2", async () => {
      // Register investor A (InnovestX) and investor B (Dime) and owner/controller
      await proxy.registerWallet(owner.address, BROKER_INNOVESTX);
      await proxy.registerWallet(investorA.address, BROKER_INNOVESTX);
      await proxy.registerWallet(investorB.address, BROKER_DIME);
      await proxy.registerWallet(await controller.getAddress(), BROKER_INNOVESTX); // FundController registered

      // Grant FundController ALLOTMENT_ROLE
      const ALLOTMENT_ROLE = await controller.ALLOTMENT_ROLE();
      await controller.grantRole(ALLOTMENT_ROLE, owner.address);

      // Fund Controller Reserve
      await token.mint(ethers.parseEther("1000"));
      await token.approve(await controller.getAddress(), ethers.parseEther("1000"));
      await controller.fundBrokerReserve(BROKER_INNOVESTX, ethers.parseEther("500"));

      // Allot shares to Alice (InnovestX)
      const subId = ethers.keccak256(ethers.toUtf8Bytes("SUB-101"));
      await controller.allotShares(investorA.address, ethers.parseEther("100"), subId);
      expect(await token.balanceOf(investorA.address)).to.equal(ethers.parseEther("100"));

      // Transfer Alice (InnovestX) -> Bob (Dime): Fails before corridor opened
      await expect(
        token.connect(investorA).transfer(investorB.address, ethers.parseEther("20"))
      ).to.be.revertedWithCustomError(proxy, "CrossBrokerTransferNotAllowed");

      // Open Corridor InnovestX <-> Dime
      await proxy.setCorridor(BROKER_INNOVESTX, BROKER_DIME, true);

      // Transfer Alice -> Bob succeeds and auto-syncs FundController per-broker ledger
      await token.connect(investorA).transfer(investorB.address, ethers.parseEther("20"));
      expect(await token.balanceOf(investorA.address)).to.equal(ethers.parseEther("80"));
      expect(await token.balanceOf(investorB.address)).to.equal(ethers.parseEther("20"));

      // Check FundController per-broker ledger
      expect(await controller.totalSharesByBroker(BROKER_INNOVESTX)).to.equal(ethers.parseEther("80"));
      expect(await controller.totalSharesByBroker(BROKER_DIME)).to.equal(ethers.parseEther("20"));
      expect(await controller.totalShares()).to.equal(ethers.parseEther("100"));
    });
  });
});
