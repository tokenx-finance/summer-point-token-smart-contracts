import { expect } from "chai";
import { ethers } from "hardhat";

let ONE_MILLION = ethers.parseEther("1000000");
const ONE_THOUSAND = ethers.parseEther("1000");
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

describe("InvestmentTokenM Contract", () => {
  let token: any;
  let registry: any;
  let OWNER: any;
  let ADDR1: any;
  let ADDR2: any;

  beforeEach(async () => {
    const Registry = await ethers.getContractFactory("AllowlistRegistry");
    const Token = await ethers.getContractFactory("InvestmentTokenM");
    [OWNER, ADDR1, ADDR2] = await ethers.getSigners();

    registry = await Registry.deploy();
    const registryAddr = await registry.getAddress();
    token = await Token.deploy("Investment Token", "ITK", registryAddr);

    await token.mint(ONE_MILLION);
  });

  describe("Initialize", () => {
    it("Should assign the total supply of tokens to the owner", async () => {
      expect(await token.balanceOf(OWNER.address)).to.equal(ONE_MILLION);
    });
  });

  describe("ERC20Mintable", () => {
    describe("mint", () => {
      it("Should mint tokens to the owner", async () => {
        await token.mint(ONE_THOUSAND);

        const expected = ONE_MILLION + ONE_THOUSAND;

        expect(await token.balanceOf(OWNER.address)).to.equal(expected);
      });

      it("Should mint failed when caller is not the owner", async () => {
        await expect(token.connect(ADDR1).adminTransfer(ADDR2.address, ADDR1.address, ONE_THOUSAND)).to.be.revertedWith(
          "Ownable: caller is not the owner"
        );
      });

      it("Should mint failed when mintable has renounced", async () => {
        await token.renounceMintable();

        await expect(token.mint(ONE_THOUSAND)).to.be.revertedWith("ERC20Mintable: mintable has renounced");
      });
    });

    describe("renounceMintable", () => {
      it("Should renounceMintable", async () => {
        await token.renounceMintable();

        expect(await token.mintable()).to.be.false;
      });

      it("Should renounceMintable failed when caller is not the owner", async () => {
        await expect(token.connect(ADDR1).renounceMintable()).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("Should renounceMintable failed when mintable has renounced", async () => {
        await token.renounceMintable();

        await expect(token.renounceMintable()).to.be.revertedWith("ERC20Mintable: mintable has renounced");
      });
    });
  });

  describe("Admin", () => {
    describe("adminTransfer", () => {
      it("Should adminTransfer when sender is the owner", async () => {
        await token.adminTransfer(OWNER.address, ADDR1.address, ONE_THOUSAND);

        expect(await token.balanceOf(ADDR1.address)).to.equal(ONE_THOUSAND);

        await token.adminTransfer(ADDR1.address, OWNER.address, ONE_THOUSAND);

        expect(await token.balanceOf(OWNER.address)).to.equal(ONE_MILLION);
      });

      it("Should adminTransfer failed when amount exceeds balance", async () => {
        await expect(token.adminTransfer(ADDR2.address, ADDR1.address, ONE_THOUSAND)).to.be.revertedWith(
          "ERC20: transfer amount exceeds balance"
        );
      });

      it("Should adminTransfer failed when sender is not the owner", async () => {
        await expect(token.connect(ADDR1).adminTransfer(ADDR2.address, ADDR1.address, ONE_THOUSAND)).to.be.revertedWith(
          "Ownable: caller is not the owner"
        );
      });
    });

    describe("adminBurn", () => {
      it("Should adminBurn when sender is the owner", async () => {
        await token.adminTransfer(OWNER.address, ADDR1.address, ONE_THOUSAND);

        expect(await token.balanceOf(ADDR1.address)).to.equal(ONE_THOUSAND);

        await token.adminBurn(ADDR1.address, ONE_THOUSAND);

        expect(await token.balanceOf(ADDR1.address)).to.equal(0);
      });

      it("Should adminBurn failed when amount exceeds balance", async () => {
        await expect(token.adminBurn(ADDR1.address, ONE_THOUSAND)).to.be.revertedWith(
          "ERC20: burn amount exceeds balance"
        );
      });

      it("Should adminBurn failed when sender is not the owner", async () => {
        await expect(token.connect(ADDR1).adminBurn(ADDR2.address, ONE_THOUSAND)).to.be.revertedWith(
          "Ownable: caller is not the owner"
        );
      });
    });
  });

  describe("Transfer", () => {
    it("Should transfer when sender is the owner and receiver are not allowlisted account", async () => {
      await token.transfer(ADDR1.address, ONE_THOUSAND);

      const expected = ONE_MILLION - ONE_THOUSAND;

      expect(await token.balanceOf(OWNER.address)).to.equal(expected);
      expect(await token.balanceOf(ADDR1.address)).to.equal(ONE_THOUSAND);
    });

    it("Should transfer when sender and receiver are allowlisted account", async () => {
      await token.transfer(ADDR1.address, ONE_THOUSAND);
      await registry.addAllowlist(ADDR1.address);
      await registry.addAllowlist(ADDR2.address);

      await token.connect(ADDR1).transfer(ADDR2.address, ONE_THOUSAND);

      const expected = ONE_MILLION - ONE_THOUSAND;

      expect(await token.balanceOf(OWNER.address)).to.equal(expected);
      expect(await token.balanceOf(ADDR1.address)).to.equal(0);
      expect(await token.balanceOf(ADDR2.address)).to.equal(ONE_THOUSAND);
    });

    it("Should transfer failed when sender are not allowlisted account", async () => {
      await token.transfer(ADDR1.address, ONE_THOUSAND);

      await expect(token.connect(ADDR1).transfer(OWNER.address, ONE_THOUSAND)).to.be.revertedWith(
        "InvestmentTokenM: account are not allowlisted"
      );
    });

    it("Should transfer failed when receiver are not allowlisted account", async () => {
      await token.transfer(ADDR1.address, ONE_THOUSAND);
      await registry.addAllowlist(ADDR1.address);

      await expect(token.connect(ADDR1).transfer(ADDR2.address, ONE_THOUSAND)).to.be.revertedWith(
        "InvestmentTokenM: account are not allowlisted"
      );
    });

    it("Should transferFrom when owner and spender are allowlisted account", async () => {
      await token.transfer(ADDR1.address, ONE_THOUSAND);
      await registry.addAllowlist(ADDR1.address);
      await registry.addAllowlist(ADDR2.address);
      await token.connect(ADDR1).approve(ADDR2.address, ONE_THOUSAND);

      await token.connect(ADDR2).transferFrom(ADDR1.address, ADDR2.address, ONE_THOUSAND);

      expect(await token.balanceOf(ADDR1.address)).to.equal(0);
      expect(await token.balanceOf(ADDR2.address)).to.equal(ONE_THOUSAND);
    });

    it("Should transferFrom failed when owner are not allowlisted account", async () => {
      await token.transfer(ADDR1.address, ONE_THOUSAND);
      await registry.addAllowlist(ADDR1.address);
      await registry.addAllowlist(ADDR2.address);

      await token.connect(ADDR1).approve(ADDR2.address, ONE_THOUSAND);
      await registry.removeAllowlist(ADDR1.address);

      await expect(token.connect(ADDR2).transferFrom(ADDR1.address, ADDR2.address, ONE_THOUSAND)).to.be.revertedWith(
        "InvestmentTokenM: account are not allowlisted"
      );
    });

    it("Should transferFrom failed when spender are not allowlisted account", async () => {
      await token.transfer(ADDR1.address, ONE_THOUSAND);
      await registry.addAllowlist(ADDR1.address);
      await registry.addAllowlist(ADDR2.address);

      await token.connect(ADDR1).approve(ADDR2.address, ONE_THOUSAND);

      await registry.removeAllowlist(ADDR2.address);

      await expect(token.connect(ADDR2).transferFrom(ADDR1.address, ADDR2.address, ONE_THOUSAND)).to.be.revertedWith(
        "InvestmentTokenM: account are not allowlisted"
      );
    });
  });

  describe("Allowance", () => {
    it("Should approve when owner and spender are allowlisted account", async () => {
      await registry.addAllowlist(ADDR1.address);
      await registry.addAllowlist(ADDR2.address);

      await token.connect(ADDR1).approve(ADDR2.address, ONE_THOUSAND);

      expect(await token.allowance(ADDR1.address, ADDR2.address)).to.equal(ONE_THOUSAND);
    });

    it("Should approve failed when owner are not allowlisted account", async () => {
      await registry.addAllowlist(ADDR1.address);
      await registry.addAllowlist(ADDR2.address);

      await registry.removeAllowlist(ADDR1.address);
      await expect(token.connect(ADDR1).approve(ADDR2.address, ONE_THOUSAND)).to.be.revertedWith(
        "InvestmentTokenM: account are not allowlisted"
      );
    });

    it("Should approve failed when spender are not allowlisted account", async () => {
      await registry.addAllowlist(ADDR1.address);
      await registry.addAllowlist(ADDR2.address);

      await registry.removeAllowlist(ADDR2.address);
      await expect(token.connect(ADDR1).approve(ADDR2.address, ONE_THOUSAND)).to.be.revertedWith(
        "InvestmentTokenM: account are not allowlisted"
      );
    });

    it("Should increaseAllowance owner and spender are allowlisted account", async () => {
      await registry.addAllowlist(ADDR1.address);
      await registry.addAllowlist(ADDR2.address);

      await token.connect(ADDR1).approve(ADDR2.address, ONE_THOUSAND);
      await token.connect(ADDR1).increaseAllowance(ADDR2.address, ONE_THOUSAND);

      const expected = ONE_THOUSAND + ONE_THOUSAND;

      expect(await token.allowance(ADDR1.address, ADDR2.address)).to.equal(expected);
    });

    it("Should increaseAllowance failed when owner are not allowlisted account", async () => {
      await registry.addAllowlist(ADDR1.address);
      await registry.addAllowlist(ADDR2.address);

      await registry.removeAllowlist(ADDR1.address);
      await expect(token.connect(ADDR1).increaseAllowance(ADDR2.address, ONE_THOUSAND)).to.be.revertedWith(
        "InvestmentTokenM: account are not allowlisted"
      );
    });

    it("Should increaseAllowance failed when spender are not allowlisted account", async () => {
      await registry.addAllowlist(ADDR1.address);
      await registry.addAllowlist(ADDR2.address);

      await registry.removeAllowlist(ADDR2.address);
      await expect(token.connect(ADDR1).increaseAllowance(ADDR2.address, ONE_THOUSAND)).to.be.revertedWith(
        "InvestmentTokenM: account are not allowlisted"
      );
    });

    it("Should decreaseAllowance owner and spender are allowlisted account", async () => {
      await registry.addAllowlist(ADDR1.address);
      await registry.addAllowlist(ADDR2.address);

      const TWO_THOUSAND = ONE_THOUSAND + ONE_THOUSAND;

      await token.connect(ADDR1).approve(ADDR2.address, TWO_THOUSAND);
      await token.connect(ADDR1).decreaseAllowance(ADDR2.address, ONE_THOUSAND);

      expect(await token.allowance(ADDR1.address, ADDR2.address)).to.equal(ONE_THOUSAND);
    });

    it("Should decreaseAllowance failed when owner are not allowlisted account", async () => {
      await registry.addAllowlist(ADDR1.address);
      await registry.addAllowlist(ADDR2.address);

      await registry.removeAllowlist(ADDR1.address);
      await expect(token.connect(ADDR1).decreaseAllowance(ADDR2.address, ONE_THOUSAND)).to.be.revertedWith(
        "InvestmentTokenM: account are not allowlisted"
      );
    });

    it("Should decreaseAllowance failed when spender are not allowlisted account", async () => {
      await registry.addAllowlist(ADDR1.address);
      await registry.addAllowlist(ADDR2.address);

      await registry.removeAllowlist(ADDR2.address);
      await expect(token.connect(ADDR1).decreaseAllowance(ADDR2.address, ONE_THOUSAND)).to.be.revertedWith(
        "InvestmentTokenM: account are not allowlisted"
      );
    });
  });

  describe("Burnable", () => {
    it("Should burn tokens on the owner", async () => {
      await token.burn(0);

      expect(await token.balanceOf(OWNER.address)).to.equal(ONE_MILLION);

      await token.burn(ONE_MILLION);

      expect(await token.balanceOf(OWNER.address)).to.equal(0);
    });

    it("Should burn tokens on allowlisted account", async () => {
      await token.transfer(ADDR1.address, ONE_THOUSAND);
      await registry.addAllowlist(ADDR1.address);

      await token.connect(ADDR1).burn(ONE_THOUSAND);

      expect(await token.balanceOf(ADDR1.address)).to.equal(0);
    });

    it("Should burn tokens failed when account are not allowlisted", async () => {
      await token.transfer(ADDR1.address, ONE_THOUSAND);

      await expect(token.connect(ADDR1).burn(ONE_THOUSAND)).to.be.revertedWith(
        "InvestmentTokenM: account are not allowlisted"
      );
    });

    it("Should burn tokens failed when amount exceeds balance", async () => {
      await registry.addAllowlist(ADDR1.address);
      await expect(token.connect(ADDR1).burn(ONE_MILLION)).to.be.revertedWith("ERC20: burn amount exceeds balance");
    });

    it("Should burnFrom tokens from given allowance", async () => {
      await token.transfer(ADDR1.address, ONE_THOUSAND);
      await registry.addAllowlist(ADDR1.address);
      await registry.addAllowlist(ADDR2.address);

      await token.connect(ADDR1).approve(ADDR2.address, ONE_THOUSAND);

      await token.connect(ADDR2).burnFrom(ADDR1.address, ONE_THOUSAND);

      expect(await token.balanceOf(ADDR1.address)).to.equal(0);
    });

    it("Should burnFrom given allowance less than burn amounts failed", async () => {
      await token.transfer(ADDR1.address, ONE_THOUSAND);
      await registry.addAllowlist(ADDR1.address);
      await registry.addAllowlist(ADDR2.address);

      await token.connect(ADDR1).approve(ADDR2.address, ONE_THOUSAND);

      await expect(token.connect(ADDR2).burnFrom(ADDR1.address, ONE_MILLION)).to.be.revertedWith(
        "ERC20: insufficient allowance"
      );
    });

    it("Should burnFrom failed when spender are not allowlisted account", async () => {
      await token.transfer(ADDR1.address, ONE_THOUSAND);
      await registry.addAllowlist(ADDR1.address);
      await registry.addAllowlist(ADDR2.address);

      await token.connect(ADDR1).approve(ADDR2.address, ONE_THOUSAND);

      await registry.removeAllowlist(ADDR2.address);

      await expect(token.connect(ADDR2).burnFrom(ADDR1.address, ONE_MILLION)).to.be.revertedWith(
        "InvestmentTokenM: account are not allowlisted"
      );
    });

    it("Should burnFrom failed when owner are not allowlisted account", async () => {
      await token.transfer(ADDR1.address, ONE_THOUSAND);
      await registry.addAllowlist(ADDR1.address);
      await registry.addAllowlist(ADDR2.address);

      await token.connect(ADDR1).approve(ADDR2.address, ONE_THOUSAND);

      await registry.removeAllowlist(ADDR1.address);

      await expect(token.connect(ADDR2).burnFrom(ADDR1.address, ONE_MILLION)).to.be.revertedWith(
        "InvestmentTokenM: account are not allowlisted"
      );
    });
  });

  describe("ERC20TransferLimit", () => {
    describe("enableTransferLimitable", () => {
      it("Should enable success", async () => {
        await token.disableTransferLimitable();
        await token.enableTransferLimitable();

        expect(await token.transferLimitable()).to.be.true;
      });

      it("Should enable failed when sender is not the owner", async () => {
        await expect(token.connect(ADDR1).disableTransferLimitable()).to.be.revertedWith(
          "Ownable: caller is not the owner"
        );
      });

      it("Should enable failed when transfer limit enabled", async () => {
        await expect(token.enableTransferLimitable()).to.be.revertedWith("ERC20TransferLimit: transfer limit enabled");
      });
    });

    describe("disableTransferLimitable", () => {
      it("Should disable success", async () => {
        await token.disableTransferLimitable();

        expect(await token.transferLimitable()).to.be.false;
      });

      it("Should disable failed when sender is not the owner", async () => {
        await expect(token.connect(ADDR1).disableTransferLimitable()).to.be.revertedWith(
          "Ownable: caller is not the owner"
        );
      });

      it("Should disable failed when transfer limit disabled", async () => {
        await token.disableTransferLimitable();

        await expect(token.disableTransferLimitable()).to.be.revertedWith(
          "ERC20TransferLimit: transfer limit disabled"
        );
      });
    });

    describe("setTransferLimit", () => {
      it("Should setTransferLimit success", async () => {
        await token.setTransferLimit(ADDR1.address, ONE_THOUSAND);

        expect(await token.transferLimitOf(ADDR1.address)).to.deep.equal([true, ONE_THOUSAND]);
      });

      it("Should setTransferLimit failed when sender is not the owner", async () => {
        await expect(token.connect(ADDR1).setTransferLimit(ADDR1.address, ONE_THOUSAND)).to.be.revertedWith(
          "Ownable: caller is not the owner"
        );
      });

      it("Should setTransferLimit failed when account transfer limit enabled", async () => {
        await token.setTransferLimit(ADDR1.address, ONE_THOUSAND);

        await expect(token.setTransferLimit(ADDR1.address, ONE_THOUSAND)).to.be.revertedWith(
          "ERC20TransferLimit: account transfer limit enabled"
        );
      });
    });

    describe("unsetTransferLimit", () => {
      it("Should unsetTransferLimit success", async () => {
        await token.setTransferLimit(ADDR1.address, ONE_THOUSAND);
        await token.unsetTransferLimit(ADDR1.address);

        expect(await token.transferLimitOf(ADDR1.address)).to.deep.equal([false, 0n]);
      });

      it("Should unsetTransferLimit failed when sender is not the owner", async () => {
        await expect(token.connect(ADDR1).unsetTransferLimit(ADDR1.address)).to.be.revertedWith(
          "Ownable: caller is not the owner"
        );
      });

      it("Should unsetTransferLimit failed when account transfer limit disabled", async () => {
        await expect(token.unsetTransferLimit(ADDR1.address)).to.be.revertedWith(
          "ERC20TransferLimit: account transfer limit disabled"
        );
      });
    });

    describe("increaseTransferLimit", () => {
      it("Should increaseTransferLimit success when account's transfer limit are disable", async () => {
        await token.setTransferLimit(ADDR1.address, 0n);
        await token.increaseTransferLimit(ADDR1.address, ONE_THOUSAND);

        expect(await token.transferLimitOf(ADDR1.address)).to.deep.equal([true, ONE_THOUSAND]);
      });

      it("Should increaseTransferLimit success when account's transfer limit are enable", async () => {
        await token.setTransferLimit(ADDR1.address, 0n);
        await token.increaseTransferLimit(ADDR1.address, ONE_THOUSAND);

        expect(await token.transferLimitOf(ADDR1.address)).to.deep.equal([true, ONE_THOUSAND]);
      });

      it("Should increaseTransferLimit failed when sender is not the owner", async () => {
        await expect(token.connect(ADDR1).increaseTransferLimit(ADDR1.address, ONE_THOUSAND)).to.be.revertedWith(
          "Ownable: caller is not the owner"
        );
      });

      it("Should increaseTransferLimit failed when account transfer limit disabled", async () => {
        await expect(token.increaseTransferLimit(ADDR1.address, ONE_THOUSAND)).to.be.revertedWith(
          "ERC20TransferLimit: account transfer limit disabled"
        );
      });
    });

    describe("decreaseTransferLimit", () => {
      it("Should decreaseTransferLimit success", async () => {
        await token.setTransferLimit(ADDR1.address, ONE_THOUSAND);

        const ONE_HUNDRED = ethers.parseEther("100");
        const NINE_HUNDRED = ONE_THOUSAND - ONE_HUNDRED;

        await token.decreaseTransferLimit(ADDR1.address, ONE_HUNDRED);

        expect(await token.transferLimitOf(ADDR1.address)).to.deep.equal([true, NINE_HUNDRED]);
      });

      it("Should decreaseTransferLimit success when underflow should be zero value", async () => {
        await token.setTransferLimit(ADDR1.address, ONE_THOUSAND);
        await token.decreaseTransferLimit(ADDR1.address, ONE_MILLION);

        expect(await token.transferLimitOf(ADDR1.address)).to.deep.equal([true, 0n]);
      });

      it("Should decreaseTransferLimit failed when sender is not the owner", async () => {
        await expect(token.connect(ADDR1).decreaseTransferLimit(ADDR1.address, ONE_THOUSAND)).to.be.revertedWith(
          "Ownable: caller is not the owner"
        );
      });

      it("Should decreaseTransferLimit failed when account transfer limit disabled", async () => {
        await expect(token.decreaseTransferLimit(ADDR1.address, ONE_THOUSAND)).to.be.revertedWith(
          "ERC20TransferLimit: account transfer limit disabled"
        );
      });
    });

    describe("transfer", () => {
      it("Should transfer success with max transfer limit", async () => {
        await registry.addAllowlist(ADDR1.address);
        await registry.addAllowlist(ADDR2.address);
        await token.transfer(ADDR1, ONE_THOUSAND);
        await token.setTransferLimit(ADDR1.address, ONE_THOUSAND);
        await token.connect(ADDR1).transfer(ADDR2.address, ONE_THOUSAND);

        expect(await token.balanceOf(ADDR2.address)).to.equal(ONE_THOUSAND);
        expect(await token.transferLimitOf(ADDR1.address)).to.deep.equal([true, 0n]);
      });

      it("Should transfer success with partial transfer limit", async () => {
        const ONE_HUNDRED = ethers.parseEther("100");
        const NINE_HUNDRED = ethers.parseEther("900");

        await registry.addAllowlist(ADDR1.address);
        await registry.addAllowlist(ADDR2.address);
        await token.transfer(ADDR1, ONE_THOUSAND);
        await token.setTransferLimit(ADDR1.address, ONE_THOUSAND);
        await token.connect(ADDR1).transfer(ADDR2.address, ONE_HUNDRED);

        expect(await token.balanceOf(ADDR2.address)).to.equal(ONE_HUNDRED);
        expect(await token.transferLimitOf(ADDR1.address)).to.deep.equal([true, NINE_HUNDRED]);
      });

      it("Should transfer failed with exceeds transfer limit", async () => {
        await registry.addAllowlist(ADDR1.address);
        await registry.addAllowlist(ADDR2.address);
        await token.transfer(ADDR1, ONE_THOUSAND);
        await token.setTransferLimit(ADDR1.address, ONE_THOUSAND);

        await expect(token.connect(ADDR1).transfer(ADDR2.address, ONE_MILLION)).to.be.revertedWith(
          "ERC20TransferLimit: transfer exceeds limit"
        );
      });
    });

    describe("transferFrom", () => {
      it("Should transferFrom success with max transfer limit", async () => {
        await registry.addAllowlist(ADDR1.address);
        await registry.addAllowlist(ADDR2.address);

        await token.transfer(ADDR2.address, ONE_THOUSAND);
        await token.connect(ADDR2).approve(ADDR1.address, ONE_THOUSAND);

        expect(await token.allowance(ADDR2.address, ADDR1.address)).to.equal(ONE_THOUSAND);

        await token.setTransferLimit(ADDR2.address, ONE_THOUSAND);
        await token.connect(ADDR1).transferFrom(ADDR2.address, ADDR1.address, ONE_THOUSAND);

        expect(await token.balanceOf(ADDR1.address)).to.equal(ONE_THOUSAND);
        expect(await token.transferLimitOf(ADDR2.address)).to.deep.equal([true, 0n]);
      });

      it("Should transferFrom success with partial transfer limit", async () => {
        const ONE_HUNDRED = ethers.parseEther("100");
        const NINE_HUNDRED = ethers.parseEther("900");

        await registry.addAllowlist(ADDR1.address);
        await registry.addAllowlist(ADDR2.address);

        await token.transfer(ADDR2.address, ONE_THOUSAND);
        await token.connect(ADDR2).approve(ADDR1.address, ONE_HUNDRED);

        expect(await token.allowance(ADDR2.address, ADDR1.address)).to.equal(ONE_HUNDRED);

        await token.setTransferLimit(ADDR2.address, ONE_THOUSAND);
        await token.connect(ADDR1).transferFrom(ADDR2.address, ADDR1.address, ONE_HUNDRED);

        expect(await token.balanceOf(ADDR1.address)).to.equal(ONE_HUNDRED);
        expect(await token.transferLimitOf(ADDR2.address)).to.deep.equal([true, NINE_HUNDRED]);
      });

      it("Should transferFrom failed with exceeds transfer limit", async () => {
        const ONE_HUNDRED = ethers.parseEther("100");

        await registry.addAllowlist(ADDR1.address);
        await registry.addAllowlist(ADDR2.address);

        await token.transfer(ADDR2.address, ONE_THOUSAND);
        await token.connect(ADDR2).approve(ADDR1.address, ONE_HUNDRED);

        expect(await token.allowance(ADDR2.address, ADDR1.address)).to.equal(ONE_HUNDRED);

        await token.setTransferLimit(ADDR2.address, ONE_THOUSAND);
        await expect(token.connect(ADDR1).transferFrom(ADDR2.address, ADDR1.address, ONE_MILLION)).to.be.revertedWith(
          "ERC20TransferLimit: transfer exceeds limit"
        );
      });
    });
  });

  describe("ERC20AllowListableProxy", () => {
    describe("setAllowlistRegistry", () => {
      it("Should setAllowlistRegistry", async () => {
        const Registry = await ethers.getContractFactory("AllowlistRegistry");
        const registry = await Registry.deploy();
        const registryAddr = await registry.getAddress();

        await token.setAllowlistRegistry(registryAddr);
        expect(await token.allowlistRegistry()).to.equal(registryAddr);
      });

      it("Should setAllowlistRegistry failed when sender is not the owner", async () => {
        const Registry = await ethers.getContractFactory("AllowlistRegistry");
        const registry = await Registry.deploy();
        const registryAddr = await registry.getAddress();

        await expect(token.connect(ADDR1).setAllowlistRegistry(registryAddr)).to.be.revertedWith(
          "Ownable: caller is not the owner"
        );
      });
    });
  });

  describe("Pausable", () => {
    it("Should pause contract", async () => {
      await token.pause();

      expect(await token.paused()).to.be.true;
    });

    it("Should unpause contract", async () => {
      await token.pause();
      await token.unpause();

      expect(await token.paused()).to.be.false;
    });

    it("Should unpause contract failed when contract is not paused", async () => {
      await expect(token.unpause()).to.be.revertedWith("Pausable: not paused");
    });

    it("Should pause contract failed when contract is paused", async () => {
      await token.pause();

      await expect(token.pause()).to.be.revertedWith("Pausable: paused");
    });

    it("Should pause contract failed when sender is not the owner", async () => {
      await expect(token.connect(ADDR1).pause()).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should unpause contract failed when sender is not the owner", async () => {
      await expect(token.connect(ADDR1).unpause()).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("EmergencyWithdrawable", () => {
    let randomToken: any;
    let tokenAddr: string;
    let registryAddr: string;

    beforeEach(async () => {
      const RandomToken = await ethers.getContractFactory("InvestmentTokenM");

      tokenAddr = await token.getAddress();
      registryAddr = await registry.getAddress();

      randomToken = await RandomToken.deploy("Random Token", "RAND", registryAddr);
      await randomToken.mint(ONE_MILLION);
      await randomToken.transfer(tokenAddr, ONE_MILLION);
    });

    it("Should withdraw ERC20 tokens", async () => {
      await registry.addAllowlist(OWNER.address);
      await registry.addAllowlist(tokenAddr);

      const randomTokenAddr = await randomToken.getAddress();

      await token.emergencyWithdrawToken(randomTokenAddr);

      expect(await randomToken.balanceOf(tokenAddr)).to.equal(0);
      expect(await randomToken.balanceOf(OWNER.address)).to.equal(ONE_MILLION);
    });

    it("Should withdraw ERC20 tokens failed with non-ERC20 address", async () => {
      await expect(token.emergencyWithdrawToken(ZERO_ADDRESS)).to.be.reverted;
    });

    it("Should withdraw ERC20 tokens failed when sender is not the owner", async () => {
      const randomTokenAddr = await randomToken.getAddress();

      await expect(token.connect(ADDR1).emergencyWithdrawToken(randomTokenAddr)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });
  });
});
