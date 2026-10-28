import { expect } from "chai";
import { ethers } from "hardhat";

describe("Role-Based Access Control Matrix (TokenX, SCBAM, InnovestX, Public)", () => {
  let token: any;
  let gateway: any;
  let controller: any;

  let tokenXAdmin: any;
  let scbamAM: any;
  let innovestxAgent: any;
  let investorAlice: any;
  let unauthorizedBob: any;

  const BROKER_INNOVESTX = ethers.keccak256(ethers.toUtf8Bytes("InnovestX"));
  const ONE_MILLION = ethers.parseUnits("1000000", 8);
  const TEN_THOUSAND = ethers.parseUnits("10000", 8);
  const ONE_THOUSAND = ethers.parseUnits("1000", 8);

  beforeEach(async () => {
    [tokenXAdmin, scbamAM, innovestxAgent, investorAlice, unauthorizedBob] = await ethers.getSigners();

    // 1. Deploy AllowlistRegistryProxyV2
    const Gateway = await ethers.getContractFactory("AllowlistRegistryProxyV2");
    gateway = await Gateway.deploy("Multi-Broker Allowlist Proxy");

    // Register wallets in gateway
    await gateway.connect(tokenXAdmin).registerWalletsBatch(
      [tokenXAdmin.address, scbamAM.address, innovestxAgent.address, investorAlice.address],
      [BROKER_INNOVESTX, BROKER_INNOVESTX, BROKER_INNOVESTX, BROKER_INNOVESTX]
    );

    // 2. Deploy InvestmentTokenM with TokenX as deployer
    const Token = await ethers.getContractFactory("InvestmentTokenM");
    token = await Token.deploy("Tokenized Mutual Fund", "tMMF", await gateway.getAddress());

    // 3. Deploy FundController with TokenX as default admin
    const Controller = await ethers.getContractFactory("FundController");
    controller = await Controller.deploy(await token.getAddress(), tokenXAdmin.address);
    await controller.connect(tokenXAdmin).setBrokerRegistry(await gateway.getAddress());

    // Register controller in gateway
    await gateway.connect(tokenXAdmin).registerWallet(await controller.getAddress(), BROKER_INNOVESTX);

    // 4. Configure Roles
    // On Token: grant AM_ROLE to SCBAM
    const AM_ROLE = await token.AM_ROLE();
    await token.connect(tokenXAdmin).grantRole(AM_ROLE, scbamAM.address);

    // On Controller: grant AM_ROLE to SCBAM, SELLING_AGENT_ROLE to InnovestX
    const SELLING_AGENT_ROLE = await controller.SELLING_AGENT_ROLE();
    await controller.connect(tokenXAdmin).grantRole(AM_ROLE, scbamAM.address);
    await controller.connect(tokenXAdmin).grantRole(SELLING_AGENT_ROLE, innovestxAgent.address);
  });

  describe("1. InvestmentTokenM Minting & Administration", () => {
    it("1.1 SCBAM (with AM_ROLE) can mint tokens", async () => {
      await token.connect(scbamAM).mint(TEN_THOUSAND);
      expect(await token.balanceOf(scbamAM.address)).to.equal(TEN_THOUSAND);
    });

    it("1.2 Unauthorized caller cannot mint tokens", async () => {
      await expect(token.connect(unauthorizedBob).mint(TEN_THOUSAND)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });

    it("1.3 SCBAM (with AM_ROLE) can execute regulatory adminTransfer and adminBurn", async () => {
      await token.connect(scbamAM).mint(TEN_THOUSAND);
      await token.connect(scbamAM).adminTransfer(scbamAM.address, investorAlice.address, ONE_THOUSAND);
      expect(await token.balanceOf(investorAlice.address)).to.equal(ONE_THOUSAND);

      await token.connect(scbamAM).adminBurn(investorAlice.address, ONE_THOUSAND);
      expect(await token.balanceOf(investorAlice.address)).to.equal(0n);
    });

    it("1.4 TokenX (with DEFAULT_ADMIN_ROLE) can pause and unpause token", async () => {
      await token.connect(tokenXAdmin).pause();
      expect(await token.paused()).to.be.true;

      await token.connect(tokenXAdmin).unpause();
      expect(await token.paused()).to.be.false;
    });
  });

  describe("2. FundController Reserve & Selling Agent Allotment", () => {
    beforeEach(async () => {
      // SCBAM mints and funds the broker reserve
      await token.connect(scbamAM).mint(ONE_MILLION);
      await token.connect(scbamAM).approve(await controller.getAddress(), ONE_MILLION);
      await controller.connect(scbamAM).fundBrokerReserve(BROKER_INNOVESTX, ONE_MILLION);
    });

    it("2.1 InnovestX (with SELLING_AGENT_ROLE) can allot shares directly", async () => {
      const refId = ethers.id("ALLOT-ALICE-001");
      await controller.connect(innovestxAgent).allotShares(investorAlice.address, TEN_THOUSAND, refId);

      expect(await token.balanceOf(investorAlice.address)).to.equal(TEN_THOUSAND);
      expect(await controller.totalSharesByBroker(BROKER_INNOVESTX)).to.equal(TEN_THOUSAND);
    });

    it("2.2 Unauthorized caller cannot allot shares", async () => {
      const refId = ethers.id("ALLOT-BOB-FAIL");
      await expect(
        controller.connect(unauthorizedBob).allotShares(investorAlice.address, TEN_THOUSAND, refId)
      ).to.be.revertedWith(/AccessControl/);
    });

    it("2.3 InnovestX (with SELLING_AGENT_ROLE) can process subscription queue", async () => {
      const subRef = ethers.id("SUB-ORDER-001");
      await controller.connect(innovestxAgent).requestSubscribe(investorAlice.address, TEN_THOUSAND, subRef);
      expect(await controller.pendingSubscriptionQueueLength()).to.equal(1n);

      await controller.connect(innovestxAgent).processSubscriptions(1);
      expect(await token.balanceOf(investorAlice.address)).to.equal(TEN_THOUSAND);
    });
  });

  describe("3. Self-Service vs Delegated Redemption", () => {
    const redeemRef1 = ethers.id("REDEEM-ALICE-SELF");
    const redeemRef2 = ethers.id("REDEEM-ALICE-DELEGATED");

    beforeEach(async () => {
      // Setup initial shares for Alice
      await token.connect(scbamAM).mint(ONE_MILLION);
      await token.connect(scbamAM).approve(await controller.getAddress(), ONE_MILLION);
      await controller.connect(scbamAM).fundBrokerReserve(BROKER_INNOVESTX, ONE_MILLION);

      await controller.connect(innovestxAgent).allotShares(investorAlice.address, TEN_THOUSAND, ethers.id("INIT"));
      await token.connect(investorAlice).approve(await controller.getAddress(), TEN_THOUSAND);
    });

    it("3.1 Dual-mode redemption: Custodial and non-custodial wallets call requestRedemption", async () => {
      // Whether triggered by InnovestX KMS (custodial) or directly by user (self-custody),
      // msg.sender is the investor's wallet and tokens move to escrow
      await controller.connect(investorAlice).requestRedemption(ONE_THOUSAND, redeemRef1);

      const req = await controller.redemptionRequests(redeemRef1);
      expect(req.wallet).to.equal(investorAlice.address);
      expect(req.amount).to.equal(ONE_THOUSAND);
      expect(req.status).to.equal(1); // PENDING
      expect(await token.balanceOf(investorAlice.address)).to.equal(TEN_THOUSAND - ONE_THOUSAND);
    });

    it("3.2 Legacy broker orchestration: requestRedeem operates with SELLING_AGENT_ROLE", async () => {
      await controller.connect(innovestxAgent).requestRedeem(investorAlice.address, ONE_THOUSAND, redeemRef2);

      const req = await controller.redemptionRequests(redeemRef2);
      expect(req.wallet).to.equal(investorAlice.address);
      expect(req.amount).to.equal(ONE_THOUSAND);
      expect(req.status).to.equal(1); // PENDING
    });

    it("3.3 Unauthorized caller cannot call legacy requestRedeem", async () => {
      await expect(
        controller.connect(unauthorizedBob).requestRedeem(investorAlice.address, ONE_THOUSAND, ethers.id("FAIL"))
      ).to.be.revertedWith(/AccessControl/);
    });

    it("3.4 SCBAM (with AM_ROLE) can settle redemptions at Day T+1", async () => {
      await controller.connect(investorAlice).requestRedemption(ONE_THOUSAND, redeemRef1);

      // SCBAM settles
      await controller.connect(scbamAM).settleRedemptions([redeemRef1]);

      const req = await controller.redemptionRequests(redeemRef1);
      expect(req.status).to.equal(3); // SETTLED
    });

    it("3.5 Unauthorized caller cannot settle redemptions", async () => {
      await controller.connect(investorAlice).requestRedemption(ONE_THOUSAND, redeemRef1);

      await expect(controller.connect(unauthorizedBob).settleRedemptions([redeemRef1])).to.be.revertedWith(
        /AccessControl/
      );
    });
  });

  describe("4. SCBAM NAV Pricing & Reserve Sweeps", () => {
    beforeEach(async () => {
      await token.connect(scbamAM).mint(ONE_MILLION);
      await token.connect(scbamAM).approve(await controller.getAddress(), ONE_MILLION);
      await controller.connect(scbamAM).fundBrokerReserve(BROKER_INNOVESTX, ONE_MILLION);
    });

    it("4.1 SCBAM (with AM_ROLE) can set baseline and update NAV", async () => {
      const BASELINE = ethers.parseUnits("10.0000", 8);
      const NEW_NAV = ethers.parseUnits("10.0350", 8);

      await controller.connect(scbamAM).setBaselineNav(BASELINE);
      expect(await controller.latestNav()).to.equal(BASELINE);

      const currentBlock = await ethers.provider.getBlockNumber();
      await controller.connect(scbamAM).updateNav(1, NEW_NAV, currentBlock, ethers.id("REPORT-1"));
      expect(await controller.latestNav()).to.equal(NEW_NAV);
    });

    it("4.2 Unauthorized caller cannot update NAV", async () => {
      await expect(
        controller.connect(unauthorizedBob).setBaselineNav(ethers.parseUnits("10.0000", 8))
      ).to.be.revertedWith(/AccessControl/);
    });

    it("4.3 SCBAM (with AM_ROLE) can sweep broker reserve", async () => {
      const sweepAmount = ethers.parseUnits("50000", 8);
      await controller.connect(scbamAM).sweepBrokerReserve(BROKER_INNOVESTX, sweepAmount, scbamAM.address);

      expect(await token.balanceOf(scbamAM.address)).to.equal(sweepAmount);
    });

    it("4.4 Unauthorized caller cannot sweep broker reserve", async () => {
      await expect(
        controller.connect(unauthorizedBob).sweepBrokerReserve(BROKER_INNOVESTX, 1000n, unauthorizedBob.address)
      ).to.be.revertedWith(/AccessControl/);
    });
  });
});
