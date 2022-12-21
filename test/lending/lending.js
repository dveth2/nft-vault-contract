const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { takeSnapshot, revertToSnapshot } = require("../helpers/snapshot");
const { impersonateAccount } = require("../helpers/account");
const { signLoanTerms, signExtendLoanTerms } = require("../helpers/sign");
const constants = require("../constants");

const INVALID_SIGNATURE1 = "0x0000";
const INVALID_SIGNATURE2 =
  "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

describe("Spice Lending", function () {
  let vault;
  let lending;
  let note;
  let nft1, nft2;
  let weth;
  let spiceNft;
  let admin, alice, bob, strategist, assetReceiver, signer;
  let whale;
  let snapshotId;

  let defaultAdminRole, spiceRole, spiceNftRole;

  async function deployNFT() {
    const TestERC721 = await ethers.getContractFactory("TestERC721");
    const nft = await TestERC721.deploy("TestNFT", "NFT", "baseuri");

    return nft;
  }

  async function checkRole(contract, user, role, check) {
    expect(await contract.hasRole(role, user)).to.equal(check);
  }

  before("Deploy", async function () {
    [admin, alice, bob, strategist, assetReceiver, signer] =
      await ethers.getSigners();
    whale = await ethers.getSigner(constants.accounts.Whale1);
    await impersonateAccount(constants.accounts.Whale1);

    nft1 = await deployNFT();
    nft2 = await deployNFT();

    await nft1.mint(alice.address, 1);
    await nft1.mint(alice.address, 2);
    await nft1.mint(alice.address, 3);
    await nft2.mint(alice.address, 1);
    await nft2.mint(alice.address, 2);
    await nft2.mint(alice.address, 3);

    weth = await ethers.getContractAt("IWETH", constants.tokens.WETH, admin);

    await weth
      .connect(whale)
      .transfer(signer.address, ethers.utils.parseEther("100"));

    const SpiceFiNFT4626 = await ethers.getContractFactory("SpiceFiNFT4626");

    spiceNft = await upgrades.deployProxy(
      SpiceFiNFT4626,
      [strategist.address, assetReceiver.address, 700],
      {
        unsafeAllow: ["delegatecall"],
        kind: "uups",
      }
    );

    const Note = await ethers.getContractFactory("Note");

    note = await Note.deploy("Spice Note", "Spice Note");
    await note.deployed();

    const SpiceLending = await ethers.getContractFactory("SpiceLending");

    await expect(
      upgrades.deployProxy(
        SpiceLending,
        [ethers.constants.AddressZero, note.address, 500, 8000],
        {
          kind: "uups",
        }
      )
    ).to.be.revertedWithCustomError(SpiceLending, "InvalidAddress");

    await expect(
      upgrades.deployProxy(
        SpiceLending,
        [signer.address, ethers.constants.AddressZero, 500, 8000],
        {
          kind: "uups",
        }
      )
    ).to.be.revertedWithCustomError(SpiceLending, "InvalidAddress");

    await expect(
      upgrades.deployProxy(
        SpiceLending,
        [signer.address, note.address, 10001, 8000],
        {
          kind: "uups",
        }
      )
    ).to.be.revertedWithCustomError(SpiceLending, "ParameterOutOfBounds");

    await expect(
      upgrades.deployProxy(
        SpiceLending,
        [signer.address, note.address, 500, 10001],
        {
          kind: "uups",
        }
      )
    ).to.be.revertedWithCustomError(SpiceLending, "ParameterOutOfBounds");

    lending = await upgrades.deployProxy(
      SpiceLending,
      [signer.address, note.address, 500, 8000],
      {
        kind: "uups",
      }
    );

    defaultAdminRole = await lending.DEFAULT_ADMIN_ROLE();
    spiceRole = await lending.SPICE_ROLE();
    spiceNftRole = await lending.SPICE_NFT_ROLE();

    await note.initialize(lending.address);

    const adminRole = await note.ADMIN_ROLE();
    await checkRole(note, lending.address, adminRole, true);
  });

  beforeEach(async () => {
    snapshotId = await takeSnapshot();
  });

  afterEach(async function () {
    await revertToSnapshot(snapshotId);
  });

  describe("Deployment", function () {
    it("Should set the correct signer", async function () {
      expect(await lending["signer()"]()).to.equal(signer.address);
    });

    it("Should set the correct note", async function () {
      expect(await lending.note()).to.equal(note.address);
    });

    it("Should set the correct interest fee", async function () {
      expect(await lending.interestFee()).to.equal(500);
    });

    it("Should set the correct liquidation ratio", async function () {
      expect(await lending.liquidationRatio()).to.equal(8000);
    });

    it("Should initialize once", async function () {
      await expect(
        lending.initialize(signer.address, note.address, 500, 8000)
      ).to.be.revertedWith("Initializable: contract is already initialized");
    });

    it("Should be upgraded only by default admin", async function () {
      let SpiceLending = await ethers.getContractFactory("SpiceLending", alice);

      await expect(
        upgrades.upgradeProxy(lending.address, SpiceLending)
      ).to.be.revertedWith(
        `AccessControl: account ${alice.address.toLowerCase()} is missing role ${defaultAdminRole}`
      );

      SpiceLending = await ethers.getContractFactory("SpiceLending", admin);

      await upgrades.upgradeProxy(lending.address, SpiceLending);
    });
  });

  describe("Setters", function () {
    describe("Set Signer", function () {
      it("Only admin call call", async function () {
        await expect(
          lending.connect(alice).setSigner(bob.address)
        ).to.be.revertedWith(
          `AccessControl: account ${alice.address.toLowerCase()} is missing role ${defaultAdminRole}`
        );
      });

      it("Should not set zero address", async function () {
        await expect(
          lending.connect(admin).setSigner(ethers.constants.AddressZero)
        ).to.be.revertedWithCustomError(lending, "InvalidAddress");
      });

      it("Should set new signer address", async function () {
        await lending.connect(admin).setSigner(bob.address);
        expect(await lending["signer()"]()).to.equal(bob.address);
      });
    });

    describe("Set Interest Fee", function () {
      it("Only admin call call", async function () {
        await expect(
          lending.connect(alice).setInterestFee(1000)
        ).to.be.revertedWith(
          `AccessControl: account ${alice.address.toLowerCase()} is missing role ${defaultAdminRole}`
        );
      });

      it("Should not set bigger than DENOMINATOR", async function () {
        await expect(
          lending.connect(admin).setInterestFee(10001)
        ).to.be.revertedWithCustomError(lending, "ParameterOutOfBounds");
      });

      it("Should set new interest fee", async function () {
        const tx = await lending.connect(admin).setInterestFee(1000);
        expect(await lending.interestFee()).to.equal(1000);
        await expect(tx).to.emit(lending, "InterestFeeUpdated").withArgs(1000);
      });
    });

    describe("Set Liquidation Ratio", function () {
      it("Only admin call call", async function () {
        await expect(
          lending.connect(alice).setLiquidationRatio(7000)
        ).to.be.revertedWith(
          `AccessControl: account ${alice.address.toLowerCase()} is missing role ${defaultAdminRole}`
        );
      });

      it("Should not set bigger than DENOMINATOR", async function () {
        await expect(
          lending.connect(admin).setLiquidationRatio(10001)
        ).to.be.revertedWithCustomError(lending, "ParameterOutOfBounds");
      });

      it("Should set new liquidation ratio", async function () {
        const tx = await lending.connect(admin).setLiquidationRatio(7000);
        expect(await lending.liquidationRatio()).to.equal(7000);
        await expect(tx)
          .to.emit(lending, "LiquidationRatioUpdated")
          .withArgs(7000);
      });
    });
  });

  describe("Initiate Loan", function () {
    let loanTerms;

    beforeEach(function () {
      loanTerms = {
        baseTerms: {
          collateralAddress: nft1.address,
          collateralId: 1,
          expiration: Math.floor(Date.now() / 1000) + 30 * 60,
          lender: signer.address,
          borrower: alice.address,
        },
        principal: ethers.utils.parseEther("10"),
        interestRate: 500,
        duration: 10 * 24 * 3600, // 10 days
        currency: weth.address,
      };
    });

    it("When loan terms expired", async function () {
      loanTerms.baseTerms.expiration = Math.floor(Date.now() / 1000) - 10 * 60;
      const signature = await signLoanTerms(signer, lending.address, loanTerms);
      await expect(
        lending.connect(alice).initiateLoan(loanTerms, signature)
      ).to.be.revertedWithCustomError(lending, "LoanTermsExpired");
    });

    it("When signature is invalid #1", async function () {
      const signature = INVALID_SIGNATURE1;
      await expect(
        lending.connect(alice).initiateLoan(loanTerms, signature)
      ).to.be.revertedWith("ECDSA: invalid signature length");
    });

    it("When signature is invalid #2", async function () {
      const signature = INVALID_SIGNATURE2;
      await expect(
        lending.connect(alice).initiateLoan(loanTerms, signature)
      ).to.be.revertedWith("ECDSA: invalid signature 'v' value");
    });

    it("When signature is invalid #3", async function () {
      const signature = await signLoanTerms(bob, lending.address, loanTerms);
      await expect(
        lending.connect(alice).initiateLoan(loanTerms, signature)
      ).to.be.revertedWithCustomError(lending, "InvalidSignature");
    });

    it("When collateral is not approved", async function () {
      const signature = await signLoanTerms(signer, lending.address, loanTerms);
      await expect(
        lending.connect(alice).initiateLoan(loanTerms, signature)
      ).to.be.revertedWith("ERC721: caller is not token owner nor approved");
    });

    it("When currency is not approved", async function () {
      await nft1.connect(alice).setApprovalForAll(lending.address, true);
      const signature = await signLoanTerms(signer, lending.address, loanTerms);
      await expect(
        lending.connect(alice).initiateLoan(loanTerms, signature)
      ).to.be.revertedWith("SafeERC20: low-level call failed");
    });

    it("Initiates a new loan and transfer tokens", async function () {
      await nft1.connect(alice).setApprovalForAll(lending.address, true);
      await weth
        .connect(signer)
        .approve(lending.address, ethers.constants.MaxUint256);
      const signature = await signLoanTerms(signer, lending.address, loanTerms);
      const loanId = await lending
        .connect(alice)
        .callStatic.initiateLoan(loanTerms, signature);
      const tx = await lending
        .connect(alice)
        .initiateLoan(loanTerms, signature);

      await expect(tx)
        .to.emit(lending, "LoanStarted")
        .withArgs(loanId, alice.address);

      expect(await note.ownerOf(loanId)).to.be.eq(signer.address);
      expect(await weth.balanceOf(alice.address)).to.be.eq(loanTerms.principal);
      expect(await nft1.ownerOf(1)).to.be.eq(lending.address);

      const loanData = await lending.getLoanData(loanId);
      expect(loanData.state).to.be.eq(1);
      expect(loanData.balance).to.be.eq(loanTerms.principal);
      expect(loanData.interestAccrued).to.be.eq(0);
      expect(loanData.startedAt).to.be.eq(loanData.updatedAt);
    });
  });

  describe("Extend Loan", function () {
    let loanId;
    let terms;

    before(async function () {
      const loanTerms = {
        baseTerms: {
          collateralAddress: nft1.address,
          collateralId: 1,
          expiration: Math.floor(Date.now() / 1000) + 30 * 60,
          lender: signer.address,
          borrower: alice.address,
        },
        principal: ethers.utils.parseEther("10"),
        interestRate: 500,
        duration: 10 * 24 * 3600, // 10 days
        currency: weth.address,
      };
      await nft1.connect(alice).setApprovalForAll(lending.address, true);
      await weth
        .connect(signer)
        .approve(lending.address, ethers.constants.MaxUint256);
      const signature = await signLoanTerms(signer, lending.address, loanTerms);
      loanId = await lending
        .connect(alice)
        .callStatic.initiateLoan(loanTerms, signature);
      await lending.connect(alice).initiateLoan(loanTerms, signature);
    });

    beforeEach(function () {
      terms = {
        baseTerms: {
          collateralAddress: nft1.address,
          collateralId: 1,
          expiration: Math.floor(Date.now() / 1000) + 30 * 60,
          lender: signer.address,
          borrower: alice.address,
        },
        additionalPrincipal: ethers.utils.parseEther("2"),
        newInterestRate: 550,
        additionalDuration: 2 * 24 * 3600, // 10 days
      };
    });

    it("When loan is not active", async function () {
      await expect(lending.connect(alice).extendLoan(loanId + 1, terms, "0x"))
        .to.be.revertedWithCustomError(lending, "InvalidState")
        .withArgs(0);
    });

    it("When caller is not borrower", async function () {
      await expect(
        lending.connect(bob).extendLoan(loanId, terms, "0x")
      ).to.be.revertedWithCustomError(lending, "InvalidMsgSender");
    });

    it("When loan terms expired", async function () {
      terms.baseTerms.expiration = Math.floor(Date.now() / 1000) - 10 * 60;
      const signature = await signExtendLoanTerms(
        signer,
        lending.address,
        terms
      );
      await expect(
        lending.connect(alice).extendLoan(loanId, terms, signature)
      ).to.be.revertedWithCustomError(lending, "LoanTermsExpired");
    });

    it("When signature is invalid #1", async function () {
      const signature = INVALID_SIGNATURE1;
      await expect(
        lending.connect(alice).extendLoan(loanId, terms, signature)
      ).to.be.revertedWith("ECDSA: invalid signature length");
    });

    it("When signature is invalid #2", async function () {
      const signature = INVALID_SIGNATURE2;
      await expect(
        lending.connect(alice).extendLoan(loanId, terms, signature)
      ).to.be.revertedWith("ECDSA: invalid signature 'v' value");
    });

    it("When signature is invalid #3", async function () {
      const signature = await signExtendLoanTerms(bob, lending.address, terms);
      await expect(
        lending.connect(alice).extendLoan(loanId, terms, signature)
      ).to.be.revertedWithCustomError(lending, "InvalidSignature");
    });

    it("When currency is not approved", async function () {
      await weth.connect(signer).approve(lending.address, 0);
      const signature = await signExtendLoanTerms(
        signer,
        lending.address,
        terms
      );
      await expect(
        lending.connect(alice).extendLoan(loanId, terms, signature)
      ).to.be.revertedWith("SafeERC20: low-level call failed");
    });

    it("Extends loan and transfer additional principal", async function () {
      await weth.connect(signer).approve(lending.address, 0);
      await weth
        .connect(signer)
        .approve(lending.address, ethers.constants.MaxUint256);
      const beforeBalance = await weth.balanceOf(alice.address);
      const oldLoanData = await lending.getLoanData(loanId);
      const signature = await signExtendLoanTerms(
        signer,
        lending.address,
        terms
      );
      const tx = await lending
        .connect(alice)
        .extendLoan(loanId, terms, signature);
      await expect(tx).to.emit(lending, "LoanExtended").withArgs(loanId);
      expect(await weth.balanceOf(alice.address)).to.be.eq(
        beforeBalance.add(terms.additionalPrincipal)
      );
      const newLoanData = await lending.getLoanData(loanId);
      expect(newLoanData.balance).to.be.eq(
        oldLoanData.balance.add(terms.additionalPrincipal)
      );
      expect(newLoanData.terms.principal).to.be.eq(
        oldLoanData.terms.principal.add(terms.additionalPrincipal)
      );
      expect(newLoanData.terms.duration).to.be.eq(
        oldLoanData.terms.duration + terms.additionalDuration
      );
      expect(newLoanData.terms.interestRate).to.be.eq(terms.newInterestRate);
    });
  });
});
