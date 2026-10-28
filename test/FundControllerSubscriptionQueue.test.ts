import { expect } from "chai";
import { ethers } from "hardhat";
import {
  FundController,
  InvestmentTokenM,
  AllowlistRegistryProxyV2,
  AllowlistRegistry
} from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("FundController: 3-State FIFO Subscription Queue & refId Architecture", () => {
  let admin: HardhatEthersSigner;
  let brokerAdmin: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let charlie: HardhatEthersSigner;

  let token: InvestmentTokenM;
  let controller: FundController;
  let proxy: AllowlistRegistryProxyV2;
  let innovestXRegistry: AllowlistRegistry;
  let dimeRegistry: AllowlistRegistry;

  const BROKER_INNOVESTX = ethers.keccak256(ethers.toUtf8Bytes("INNOVESTX"));
  const BROKER_DIME = ethers.keccak256(ethers.toUtf8Bytes("DIME"));

  const ONE_HUNDRED_TOKENS = ethers.parseEther("100");
  const FIFTY_TOKENS = ethers.parseEther("50");
  const TWENTY_TOKENS = ethers.parseEther("20");
  const TEN_TOKENS = ethers.parseEther("10");

  beforeEach(async () => {
    [admin, brokerAdmin, alice, bob, charlie] = await ethers.getSigners();

    // 1. Deploy Broker Registries
    const RegistryFactory = await ethers.getContractFactory("AllowlistRegistry");
    innovestXRegistry = await RegistryFactory.deploy();
    dimeRegistry = await RegistryFactory.deploy();

    // 2. Deploy AllowlistRegistryProxyV2
    const ProxyFactory = await ethers.getContractFactory("AllowlistRegistryProxyV2");
    proxy = await ProxyFactory.deploy("Token X Proxy");

    // Add child registries to Proxy
    await proxy.addRegistry("INNOVESTX", await innovestXRegistry.getAddress());
    await proxy.addRegistry("DIME", await dimeRegistry.getAddress());

    // 3. Onboard Wallets
    await innovestXRegistry.addAllowlist(alice.address);
    await innovestXRegistry.addAllowlist(bob.address);
    await dimeRegistry.addAllowlist(charlie.address);

    // 4. Deploy Token & FundController
    const TokenFactory = await ethers.getContractFactory("InvestmentTokenM");
    token = await TokenFactory.deploy("SCBAM tMMF", "tMMF", await proxy.getAddress());

    const ControllerFactory = await ethers.getContractFactory("FundController");
    controller = await ControllerFactory.deploy(await token.getAddress(), admin.address);

    await controller.setBrokerRegistry(await proxy.getAddress());

    // Register controller and admin in proxy
    await proxy.registerWallet(await controller.getAddress(), BROKER_INNOVESTX);
    await proxy.registerWallet(admin.address, BROKER_INNOVESTX);

    // Grant roles
    const ALLOTMENT_ROLE = await controller.ALLOTMENT_ROLE();
    await controller.grantRole(ALLOTMENT_ROLE, brokerAdmin.address);

    // Mint supply & fund broker reserves
    const mintAmount = ethers.parseEther("10000");
    await token.mint(mintAmount);
    await token.approve(await controller.getAddress(), mintAmount);

    await controller.fundBrokerReserve(BROKER_INNOVESTX, ethers.parseEther("1000"));
    await controller.fundBrokerReserve(BROKER_DIME, ethers.parseEther("1000"));
  });

  describe("1. Subscription Order Creation & FIFO Enqueueing", () => {
    it("1.1 Should request subscription orders and store in PENDING state", async () => {
      const refIdAlice = ethers.keccak256(ethers.toUtf8Bytes("REF-ALICE-01"));
      const refIdBob = ethers.keccak256(ethers.toUtf8Bytes("REF-BOB-01"));

      await expect(controller.connect(brokerAdmin).requestSubscribe(alice.address, ONE_HUNDRED_TOKENS, refIdAlice))
        .to.emit(controller, "SubscriptionRequested")
        .withArgs(refIdAlice, alice.address, BROKER_INNOVESTX, ONE_HUNDRED_TOKENS, (await ethers.provider.getBlock("latest"))!.timestamp + 1);

      await controller.connect(brokerAdmin).requestSubscribe(bob.address, FIFTY_TOKENS, refIdBob);

      expect(await controller.pendingSubscriptionQueueLength()).to.equal(2n);

      // Check order struct
      const orderAlice = await controller.subscriptionOrders(refIdAlice);
      expect(orderAlice.refId).to.equal(refIdAlice);
      expect(orderAlice.wallet).to.equal(alice.address);
      expect(orderAlice.broker).to.equal(BROKER_INNOVESTX);
      expect(orderAlice.amount).to.equal(ONE_HUNDRED_TOKENS);
      expect(orderAlice.status).to.equal(1n); // 1 = PENDING

      // Check broker metrics
      expect(await controller.pendingSubscriptionVolume(BROKER_INNOVESTX)).to.equal(ONE_HUNDRED_TOKENS + FIFTY_TOKENS);
      expect(await controller.pendingSubscriptionCount(BROKER_INNOVESTX)).to.equal(2n);

      // Check investor order history
      const aliceOrders = await controller.getInvestorSubscriptions(alice.address);
      expect(aliceOrders).to.deep.equal([refIdAlice]);
    });

    it("1.2 Should revert if order with duplicate refId is submitted", async () => {
      const refId = ethers.keccak256(ethers.toUtf8Bytes("REF-DUP-01"));
      await controller.connect(brokerAdmin).requestSubscribe(alice.address, ONE_HUNDRED_TOKENS, refId);

      await expect(
        controller.connect(brokerAdmin).requestSubscribe(alice.address, ONE_HUNDRED_TOKENS, refId)
      ).to.be.revertedWithCustomError(controller, "RefIdAlreadyUsed").withArgs(refId);
    });

    it("1.3 Should revert if subscription amount is zero", async () => {
      const refId = ethers.keccak256(ethers.toUtf8Bytes("REF-ZERO-01"));
      await expect(
        controller.connect(brokerAdmin).requestSubscribe(alice.address, 0, refId)
      ).to.be.revertedWithCustomError(controller, "ZeroAmount");
    });
  });

  describe("2. Soft Cancellation & Metrics Rebalancing", () => {
    it("2.1 Should cancel a pending subscription order in O(1) time", async () => {
      const refId = ethers.keccak256(ethers.toUtf8Bytes("REF-CANCEL-01"));
      await controller.connect(brokerAdmin).requestSubscribe(alice.address, ONE_HUNDRED_TOKENS, refId);

      await expect(controller.connect(brokerAdmin).cancelSubscribe(refId))
        .to.emit(controller, "SubscriptionCancelled");

      const order = await controller.subscriptionOrders(refId);
      expect(order.status).to.equal(2n); // 2 = CANCELLED

      // Metrics should rebalance
      expect(await controller.pendingSubscriptionVolume(BROKER_INNOVESTX)).to.equal(0n);
      expect(await controller.pendingSubscriptionCount(BROKER_INNOVESTX)).to.equal(0n);
      expect(await controller.cancelledSubscriptionVolume(BROKER_INNOVESTX)).to.equal(ONE_HUNDRED_TOKENS);
      expect(await controller.cancelledSubscriptionCount(BROKER_INNOVESTX)).to.equal(1n);
    });

    it("2.2 Should revert when trying to cancel an already cancelled or non-pending order", async () => {
      const refId = ethers.keccak256(ethers.toUtf8Bytes("REF-CANCEL-02"));
      await controller.connect(brokerAdmin).requestSubscribe(alice.address, ONE_HUNDRED_TOKENS, refId);
      await controller.connect(brokerAdmin).cancelSubscribe(refId);

      await expect(
        controller.connect(brokerAdmin).cancelSubscribe(refId)
      ).to.be.revertedWithCustomError(controller, "OrderNotPending").withArgs(refId, 2n);
    });
  });

  describe("3. Batch FIFO Processing Queue", () => {
    it("3.1 Should process pending orders in strict FIFO sequence and skip cancelled orders", async () => {
      const ref1 = ethers.keccak256(ethers.toUtf8Bytes("REF-SEQ-1")); // Alice 100
      const ref2 = ethers.keccak256(ethers.toUtf8Bytes("REF-SEQ-2")); // Bob 50 (will be cancelled)
      const ref3 = ethers.keccak256(ethers.toUtf8Bytes("REF-SEQ-3")); // Charlie 20 (Dime)

      await controller.connect(brokerAdmin).requestSubscribe(alice.address, ONE_HUNDRED_TOKENS, ref1);
      await controller.connect(brokerAdmin).requestSubscribe(bob.address, FIFTY_TOKENS, ref2);
      await controller.connect(brokerAdmin).requestSubscribe(charlie.address, TWENTY_TOKENS, ref3);

      expect(await controller.pendingSubscriptionQueueLength()).to.equal(3n);

      // Cancel Bob's order in the middle
      await controller.connect(brokerAdmin).cancelSubscribe(ref2);

      // Process batch of 10
      const tx = await controller.connect(brokerAdmin).processSubscriptions(10);
      await expect(tx).to.emit(controller, "SubscriptionSuccess").withArgs(ref1, alice.address, BROKER_INNOVESTX, ONE_HUNDRED_TOKENS, (await ethers.provider.getBlock("latest"))!.timestamp);
      await expect(tx).to.emit(controller, "SubscriptionSuccess").withArgs(ref3, charlie.address, BROKER_DIME, TWENTY_TOKENS, (await ethers.provider.getBlock("latest"))!.timestamp);

      // Verify token balances
      expect(await token.balanceOf(alice.address)).to.equal(ONE_HUNDRED_TOKENS);
      expect(await token.balanceOf(bob.address)).to.equal(0n); // Cancelled
      expect(await token.balanceOf(charlie.address)).to.equal(TWENTY_TOKENS);

      // Queue should now be empty
      expect(await controller.pendingSubscriptionQueueLength()).to.equal(0n);

      // Check broker ledger breakdowns
      expect(await controller.totalSharesByBroker(BROKER_INNOVESTX)).to.equal(ONE_HUNDRED_TOKENS);
      expect(await controller.totalSharesByBroker(BROKER_DIME)).to.equal(TWENTY_TOKENS);
      expect(await controller.totalShares()).to.equal(ONE_HUNDRED_TOKENS + TWENTY_TOKENS);

      // Check broker success metrics
      expect(await controller.successSubscriptionVolume(BROKER_INNOVESTX)).to.equal(ONE_HUNDRED_TOKENS);
      expect(await controller.successSubscriptionVolume(BROKER_DIME)).to.equal(TWENTY_TOKENS);
      expect(await controller.successSubscriptionCount(BROKER_INNOVESTX)).to.equal(1n);
      expect(await controller.successSubscriptionCount(BROKER_DIME)).to.equal(1n);
    });

    it("3.2 Should support chunked multi-batch processing with remaining counts", async () => {
      for (let i = 1; i <= 5; i++) {
        const ref = ethers.keccak256(ethers.toUtf8Bytes(`REF-CHUNK-${i}`));
        await controller.connect(brokerAdmin).requestSubscribe(alice.address, TEN_TOKENS, ref);
      }

      expect(await controller.pendingSubscriptionQueueLength()).to.equal(5n);

      // Process batch of 2
      await controller.connect(brokerAdmin).processSubscriptions(2);
      expect(await controller.pendingSubscriptionQueueLength()).to.equal(3n);
      expect(await token.balanceOf(alice.address)).to.equal(TWENTY_TOKENS);

      // Process batch of 3
      await controller.connect(brokerAdmin).processSubscriptions(3);
      expect(await controller.pendingSubscriptionQueueLength()).to.equal(0n);
      expect(await token.balanceOf(alice.address)).to.equal(FIFTY_TOKENS);
    });
  });

  describe("4. Unified refId on Direct Allotment & Redemption", () => {
    it("4.1 Should support direct allotment and asynchronous redemption with refId", async () => {
      const allotRef = ethers.keccak256(ethers.toUtf8Bytes("DIRECT-ALLOT-01"));
      await controller.connect(brokerAdmin).allotShares(alice.address, ONE_HUNDRED_TOKENS, allotRef);
      expect(await token.balanceOf(alice.address)).to.equal(ONE_HUNDRED_TOKENS);

      // Day T: Request redemption with refId
      const redeemRef = ethers.keccak256(ethers.toUtf8Bytes("REDEEM-REF-01"));
      await token.connect(alice).approve(await controller.getAddress(), FIFTY_TOKENS);

      await expect(controller.connect(brokerAdmin).requestRedeem(alice.address, FIFTY_TOKENS, redeemRef))
        .to.emit(controller, "RedeemRequested")
        .withArgs(alice.address, BROKER_INNOVESTX, FIFTY_TOKENS, redeemRef);

      expect(await controller.lockedForRedemption(BROKER_INNOVESTX)).to.equal(FIFTY_TOKENS);

      // Cancel redemption with refId
      await expect(controller.cancelRedeem(redeemRef))
        .to.emit(controller, "RedeemCancelled")
        .withArgs(alice.address, BROKER_INNOVESTX, FIFTY_TOKENS, redeemRef);

      expect(await controller.lockedForRedemption(BROKER_INNOVESTX)).to.equal(0n);
      expect(await token.balanceOf(alice.address)).to.equal(ONE_HUNDRED_TOKENS);
    });

    it("4.2 Should reject direct allotment with pending or cancelled subscription refIds", async () => {
      const pendingRef = ethers.id("PENDING-SUB-DIRECT-ALLOT-COLLISION");
      const cancelledRef = ethers.id("CANCELLED-SUB-DIRECT-ALLOT-COLLISION");

      await controller.connect(brokerAdmin).requestSubscribe(alice.address, TEN_TOKENS, pendingRef);
      await controller.connect(brokerAdmin).requestSubscribe(alice.address, TEN_TOKENS, cancelledRef);
      await controller.connect(brokerAdmin).cancelSubscribe(cancelledRef);

      await expect(controller.connect(brokerAdmin).allotShares(alice.address, TEN_TOKENS, pendingRef))
        .to.be.revertedWithCustomError(controller, "RefIdAlreadyUsed")
        .withArgs(pendingRef);
      await expect(controller.connect(brokerAdmin).allotShares(alice.address, TEN_TOKENS, cancelledRef))
        .to.be.revertedWithCustomError(controller, "RefIdAlreadyUsed")
        .withArgs(cancelledRef);
    });
  });

  describe("5. Explicit Array Batching (refIds[] & Wallets[])", () => {
    it("5.1 Should process explicit array of subscription refIds", async () => {
      const refA = ethers.keccak256(ethers.toUtf8Bytes("EXPLICIT-SUB-A"));
      const refB = ethers.keccak256(ethers.toUtf8Bytes("EXPLICIT-SUB-B"));

      await controller.connect(brokerAdmin).requestSubscribe(alice.address, FIFTY_TOKENS, refA);
      await controller.connect(brokerAdmin).requestSubscribe(bob.address, TWENTY_TOKENS, refB);

      // Explicitly fulfill by array
      await controller.connect(brokerAdmin).processSubscriptionsExplicit([refA, refB]);

      expect(await token.balanceOf(alice.address)).to.equal(FIFTY_TOKENS);
      expect(await token.balanceOf(bob.address)).to.equal(TWENTY_TOKENS);

      const orderA = await controller.subscriptionOrders(refA);
      expect(orderA.status).to.equal(3n); // 3 = SUCCESS
    });

    it("5.2 Should batch cancel subscription refIds array", async () => {
      const refA = ethers.keccak256(ethers.toUtf8Bytes("BATCH-CANCEL-A"));
      const refB = ethers.keccak256(ethers.toUtf8Bytes("BATCH-CANCEL-B"));

      await controller.connect(brokerAdmin).requestSubscribe(alice.address, FIFTY_TOKENS, refA);
      await controller.connect(brokerAdmin).requestSubscribe(bob.address, TWENTY_TOKENS, refB);

      await controller.connect(brokerAdmin).cancelSubscribeBatch([refA, refB]);

      const orderA = await controller.subscriptionOrders(refA);
      const orderB = await controller.subscriptionOrders(refB);
      expect(orderA.status).to.equal(2n); // 2 = CANCELLED
      expect(orderB.status).to.equal(2n); // 2 = CANCELLED
    });

    it("5.3 Should batch cancel multiple redemptions with cancelRedeemBatch", async () => {
      // First allot tokens to Alice and Bob
      await controller.connect(brokerAdmin).allotShares(alice.address, ONE_HUNDRED_TOKENS, ethers.id("ALLOT-A"));
      await controller.connect(brokerAdmin).allotShares(bob.address, FIFTY_TOKENS, ethers.id("ALLOT-B"));

      // Request redemptions
      const refRedeemA = ethers.keccak256(ethers.toUtf8Bytes("REDEEM-A"));
      const refRedeemB = ethers.keccak256(ethers.toUtf8Bytes("REDEEM-B"));

      await token.connect(alice).approve(await controller.getAddress(), FIFTY_TOKENS);
      await token.connect(bob).approve(await controller.getAddress(), TWENTY_TOKENS);

      await controller.connect(brokerAdmin).requestRedeem(alice.address, FIFTY_TOKENS, refRedeemA);
      await controller.connect(brokerAdmin).requestRedeem(bob.address, TWENTY_TOKENS, refRedeemB);

      expect(await controller.lockedForRedemption(BROKER_INNOVESTX)).to.equal(FIFTY_TOKENS + TWENTY_TOKENS);

      // SCBAM cancels both in a single batch
      await controller.connect(admin).cancelRedeemBatch([refRedeemA, refRedeemB]);

      expect(await controller.lockedForRedemption(BROKER_INNOVESTX)).to.equal(0n);
      expect(await token.balanceOf(alice.address)).to.equal(ONE_HUNDRED_TOKENS);
      expect(await token.balanceOf(bob.address)).to.equal(FIFTY_TOKENS);
    });
  });
});
