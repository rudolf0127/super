import { TypedDataDomain } from "@ethersproject/abstract-signer";
import { JsonRpcProvider } from "@ethersproject/providers";
import { Wallet } from "@ethersproject/wallet";
import { expect } from "chai";
import { time } from "console";
import { constants } from "ethers";
import { ethers } from "hardhat";
import { TypedData, TypedDataUtils } from "ethers-eip712";
import { Consideration, TestERC721 } from "../typechain-types";
import {
  OrderComponentsStruct,
  OrderParametersStruct,
} from "../typechain-types/Consideration";
import { faucet, whileImpersonating } from "./utils/impersonate";

describe("Consideration functional tests", function () {
  const provider = ethers.provider;
  let chainId: number;
  let marketplaceContract: Consideration;
  let testERC721: TestERC721;
  let owner: Wallet;
  let domainData: TypedData["domain"];

  const considerationTypesEip712Hash = {
    OrderComponents: [
      {
        name: "offerer",
        type: "address",
      },
      { name: "facilitator", type: "address" },
      { name: "orderType", type: "uint8" },
      { name: "startTime", type: "uint256" },
      { name: "endTime", type: "uint256" },
      { name: "salt", type: "uint256" },
      { name: "offer", type: "Asset[]" },
      { name: "consideration", type: "ReceivedAsset[]" },
      { name: "nonce", type: "uint256" },
    ],
    Asset: [
      { name: "assetType", type: "uint8" },
      { name: "token", type: "address" },
      { name: "identifierOrCriteria", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    ReceivedAsset: [
      { name: "assetType", type: "uint8" },
      { name: "token", type: "address" },
      { name: "identifierOrCriteria", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "account", type: "address" },
    ],
  };

  const considerationTypesEip712HashUint256 = {
    OrderComponents: [
      {
        name: "offerer",
        type: "address",
      },
      { name: "facilitator", type: "address" },
      { name: "orderType", type: "uint256" },
      { name: "startTime", type: "uint256" },
      { name: "endTime", type: "uint256" },
      { name: "salt", type: "uint256" },
      { name: "offer", type: "Asset[]" },
      { name: "consideration", type: "ReceivedAsset[]" },
      { name: "nonce", type: "uint256" },
    ],
    Asset: [
      { name: "assetType", type: "uint256" },
      { name: "token", type: "address" },
      { name: "identifierOrCriteria", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    ReceivedAsset: [
      { name: "assetType", type: "uint256" },
      { name: "token", type: "address" },
      { name: "identifierOrCriteria", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "account", type: "address" },
    ],
  };

  before(async () => {
    const network = await provider.getNetwork();
    chainId = network.chainId;
    owner = ethers.Wallet.createRandom().connect(provider);
    await Promise.all(
      [owner].map((wallet) => faucet(wallet.address, provider))
    );

    const considerationFactory = await ethers.getContractFactory(
      "Consideration"
    );
    const TestERC721Factory = await ethers.getContractFactory(
      "TestERC721",
      owner
    );
    marketplaceContract = await considerationFactory.deploy();
    testERC721 = await TestERC721Factory.deploy();

    // Required for EIP712 signing
    domainData = {
      name: "Consideration",
      version: "1",
      chainId: chainId,
      verifyingContract: marketplaceContract.address,
    };
  });

  // Buy now or accept offer for a single ERC721 or ERC1155 in exchange for
  // ETH, WETH or ERC20
  describe("Basic buy now or accept offer flows", async () => {
    let seller: Wallet;
    let buyer: Wallet;

    beforeEach(async () => {
      // Setup basic buyer/seller wallets with ETH
      seller = ethers.Wallet.createRandom().connect(provider);
      buyer = ethers.Wallet.createRandom().connect(provider);
      await Promise.all(
        [owner, seller, buyer].map((wallet) => faucet(wallet.address, provider))
      );
    });

    // Returns signature
    async function signOrder(
      orderComponents: OrderComponentsStruct,
      signer: Wallet
    ) {
      return await signer._signTypedData(
        domainData,
        considerationTypesEip712Hash,
        orderComponents
      );
    }

    async function signOrderWithEip712Lib(
      orderComponents: OrderComponentsStruct,
      signer: Wallet
    ) {
      const typedData: TypedData = {
        types: {
          EIP712Domain: [
            { name: "name", type: "string" },
            { name: "version", type: "string" },
            { name: "chainId", type: "uint256" },
            { name: "verifyingContract", type: "address" },
          ],
          ...considerationTypesEip712Hash,
        },
        primaryType: "OrderComponents" as const,
        domain: domainData,
        message: orderComponents,
      };

      console.log("TypedData:", typedData);

      const digest = TypedDataUtils.encodeDigest(typedData);
      const digestHex = ethers.utils.hexlify(digest);
      console.log("digest: ", digest);
      console.log("DigestHex: ", digestHex);

      // const encodedData = TypedDataUtils.encodeData(typedData);
      return await signer.signMessage(ethers.utils.arrayify(digest));
      /**
       * digest:  Uint8Array(32) [
  144,  8, 170,  95,  35, 140,  11, 225,
  155, 39, 211,  59, 103,  31, 118, 103,
  152, 30, 114, 187, 113, 200,  32, 248,
  181, 51, 116, 137, 120,  45, 189, 158
]
DigestHex:  0x9008aa5f238c0be19b27d33b671f7667981e72bb71c820f8b5337489782dbd9e
sigFromEip712Lib: 0x44f6c0e7d88f980f29da33b3e3ecbef759fbbe80e6b9e94f5b91af589696f20a173e93f5028dcc07c3b4b789e7099ef37013a83dfbd8061d1065115a3bc74e481b
       */
    }

    describe("A single ERC721 is to be transferred", async () => {
      describe("[Buy now] User fullfills a sell order for a single ERC721", async () => {
        it.only("ERC721 <=> ETH", async () => {
          // Seller mints nft
          const nftId = 0;
          await testERC721.mint(seller.address, nftId);
          const oneHourIntoFutureInSecs = Math.floor(
            new Date().getTime() / 1000 + 60 * 60
          );
          // Seller creates a sell order of 10 eth for nft
          const orderParameters: OrderParametersStruct = {
            offerer: seller.address,
            facilitator: constants.AddressZero,
            orderType: 0, // FULL_OPEN
            salt: 1,
            startTime: 0,
            endTime: oneHourIntoFutureInSecs,
            offer: [
              {
                assetType: 2, // ERC721
                token: testERC721.address,
                identifierOrCriteria: nftId,
                amount: 1,
              },
            ],
            consideration: [
              {
                assetType: 0, // ETH
                token: constants.AddressZero,
                identifierOrCriteria: 0, // ignored for ETH
                amount: ethers.utils.parseEther("10"),
                account: seller.address,
              },
            ],
          };

          const orderComponents = {
            ...orderParameters,
            nonce: 0,
          };

          const flatSig = await signOrder(orderComponents, seller);
          console.log("flatsig:", flatSig);

          const sigFromEip712Lib = await signOrderWithEip712Lib(
            orderComponents,
            seller
          );
          console.log("sigFromEip712Lib:", sigFromEip712Lib);

          const orderHash = await marketplaceContract
            .connect(buyer.address)
            .getOrderHash(orderComponents);
          console.log("orderHash", orderHash);

          const domainSeparator = await marketplaceContract
            .connect(buyer.address)
            .DOMAIN_SEPARATOR();
          console.log("domainSeparator", domainSeparator);

          // recover signer from signature and domain separator + order hash

          const digest = await marketplaceContract.getDigest(orderHash);
          console.log("Digest from contract:", digest);

          // Sign digest directly
          const signatureUsingContractDigest = await seller.signMessage(
            ethers.utils.arrayify(digest)
          );

          console.log(
            "signatureUsingContractDigest:",
            signatureUsingContractDigest
          );

          const order = {
            parameters: orderParameters,
            signature: flatSig,
          };

          await whileImpersonating(buyer.address, provider, async () => {
            await expect(marketplaceContract.connect(buyer).fulfillOrder(order))
              .to.emit(marketplaceContract, "OrderFulfilled")
              .withArgs(orderHash, seller.address, constants.AddressZero);
          });
        });
        it("ERC721 <=> WETH", async () => {});
        it("ERC721 <=> ERC20", async () => {});
      });
      describe("[Accept offer] User accepts a buy offer on a single ERC721", async () => {
        // Note: ETH is not a possible case
        it("ERC721 <=> WETH", async () => {});
        it("ERC721 <=> ERC20", async () => {});
      });
    });

    describe("A single ERC1155 is to be transferred", async () => {
      describe("[Buy now] User fullfills a sell order for a single ERC1155", async () => {
        describe("ERC1155 <=> ETH", async () => {});
        describe("ERC1155 <=> WETH", async () => {});
        describe("ERC1155 <=> ERC20", async () => {});
      });
      describe("[Accept offer] User accepts a buy offer on a single ERC1155", async () => {
        // Note: ETH is not a possible case
        describe("ERC1155 <=> WETH", async () => {});
        describe("ERC1155 <=> ERC20", async () => {});
      });
    });
  });

  describe("Auctions for single nft items", async () => {
    describe("English auction", async () => {});
    describe("Dutch auction", async () => {});
  });

  // Is this a thing?
  describe("Auctions for mixed item bundles", async () => {
    describe("English auction", async () => {});
    describe("Dutch auction", async () => {});
  });

  describe("Multiple nfts being sold or bought", async () => {
    describe("Bundles", async () => {});
    describe("Partial fills", async () => {});
  });

  //   Etc this is a brain dump
});
