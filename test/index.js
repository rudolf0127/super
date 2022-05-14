/* eslint-disable no-unused-expressions */
const { expect } = require("chai");
const { constants } = require("ethers");
const { ethers } = require("hardhat");
const { faucet, whileImpersonating } = require("./utils/impersonate");
const { deployContract } = require("./utils/contracts");
const { merkleTree } = require("./utils/criteria");
const deployConstants = require("../constants/constants");
const {
  randomHex,
  randomLarge,
  toAddress,
  toKey,
  convertSignatureToEIP2098,
  getBasicOrderParameters,
  getOfferOrConsiderationItem,
  getItemETH,
} = require("./utils/encoding");
const { orderType } = require("../eip-712-types/order");

const VERSION = !process.env.REFERENCE ? "1" : "rc.1";

describe(`Consideration (version: ${VERSION}) — initial test suite`, function () {
  const provider = ethers.provider;
  let chainId;
  let zone;
  let marketplaceContract;
  let testERC20;
  let testERC721;
  let testERC1155;
  let testERC1155Two;
  let tokenByType;
  let owner;
  let domainData;
  let withBalanceChecks;
  let simulateMatchOrders;
  let simulateAdvancedMatchOrders;
  let EIP1271WalletFactory;
  let reenterer;
  let stubZone;
  let conduitController;
  let conduitImplementation;
  let conduitOne;
  let conduitKeyOne;

  const toFulfillmentComponents = (arr) =>
    arr.map(([orderIndex, itemIndex]) => ({ orderIndex, itemIndex }));

  const toFulfillment = (offerArr, considerationsArr) => ({
    offerComponents: toFulfillmentComponents(offerArr),
    considerationComponents: toFulfillmentComponents(considerationsArr),
  });

  const set721ApprovalForAll = async (signer, spender, approved = true) =>
    expect(testERC721.connect(signer).setApprovalForAll(spender, approved))
      .to.emit(testERC721, "ApprovalForAll")
      .withArgs(signer.address, spender, approved);

  const set1155ApprovalForAll = async (signer, spender, approved = true) =>
    expect(testERC1155.connect(signer).setApprovalForAll(spender, approved))
      .to.emit(testERC1155, "ApprovalForAll")
      .withArgs(signer.address, spender, approved);

  const mintAndApproveERC20 = async (signer, spender, tokenAmount) => {
    // Offerer mints ERC20
    await testERC20.mint(signer.address, tokenAmount);

    // Offerer approves marketplace contract to tokens
    await expect(testERC20.connect(signer).approve(spender, tokenAmount))
      .to.emit(testERC20, "Approval")
      .withArgs(signer.address, spender, tokenAmount);
  };

  const mintAndApprove721 = async (signer, spender) => {
    const nftId = ethers.BigNumber.from(randomHex());
    await testERC721.mint(signer.address, nftId);
    await set721ApprovalForAll(signer, spender, true);
    return nftId;
  };

  const mint1155 = async (signer, multiplier = 1) => {
    const nftId = ethers.BigNumber.from(randomHex());
    const amount = ethers.BigNumber.from(randomHex().slice(0, 10));
    await testERC1155.mint(signer.address, nftId, amount.mul(multiplier));
    return { nftId, amount };
  };

  const mintAndApprove1155 = async (signer, spender, multiplier = 1) => {
    const { nftId, amount } = await mint1155(signer, multiplier);
    await set1155ApprovalForAll(signer, spender, true);
    return { nftId, amount };
  };

  const getTestItem721 = (
    identifierOrCriteria,
    startAmount = 1,
    endAmount = 1,
    recipient
  ) =>
    getOfferOrConsiderationItem(
      2,
      testERC721.address,
      identifierOrCriteria,
      startAmount,
      endAmount,
      recipient
    );

  const getTestItem20 = (
    startAmount = 50,
    endAmount = 50,
    recipient,
    token = testERC20.address
  ) =>
    getOfferOrConsiderationItem(1, token, 0, startAmount, endAmount, recipient);

  const getTestItem1155 = (
    identifierOrCriteria,
    startAmount,
    endAmount,
    token = testERC1155.address,
    recipient
  ) =>
    getOfferOrConsiderationItem(
      3,
      token,
      identifierOrCriteria,
      startAmount,
      endAmount,
      recipient
    );

  const getAndVerifyOrderHash = async (orderComponents) => {
    const orderHash = await marketplaceContract.getOrderHash(orderComponents);

    const offerItemTypeString =
      "OfferItem(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount)";
    const considerationItemTypeString =
      "ConsiderationItem(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount,address recipient)";
    const orderComponentsPartialTypeString =
      "OrderComponents(address offerer,address zone,OfferItem[] offer,ConsiderationItem[] consideration,uint8 orderType,uint256 startTime,uint256 endTime,bytes32 zoneHash,uint256 salt,bytes32 conduitKey,uint256 nonce)";
    const orderTypeString = `${orderComponentsPartialTypeString}${considerationItemTypeString}${offerItemTypeString}`;

    const offerItemTypeHash = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes(offerItemTypeString)
    );
    const considerationItemTypeHash = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes(considerationItemTypeString)
    );
    const orderTypeHash = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes(orderTypeString)
    );

    const offerHash = ethers.utils.keccak256(
      "0x" +
        orderComponents.offer
          .map((offerItem) => {
            return ethers.utils
              .keccak256(
                "0x" +
                  [
                    offerItemTypeHash.slice(2),
                    offerItem.itemType.toString().padStart(64, "0"),
                    offerItem.token.slice(2).padStart(64, "0"),
                    ethers.BigNumber.from(offerItem.identifierOrCriteria)
                      .toHexString()
                      .slice(2)
                      .padStart(64, "0"),
                    ethers.BigNumber.from(offerItem.startAmount)
                      .toHexString()
                      .slice(2)
                      .padStart(64, "0"),
                    ethers.BigNumber.from(offerItem.endAmount)
                      .toHexString()
                      .slice(2)
                      .padStart(64, "0"),
                  ].join("")
              )
              .slice(2);
          })
          .join("")
    );

    const considerationHash = ethers.utils.keccak256(
      "0x" +
        orderComponents.consideration
          .map((considerationItem) => {
            return ethers.utils
              .keccak256(
                "0x" +
                  [
                    considerationItemTypeHash.slice(2),
                    considerationItem.itemType.toString().padStart(64, "0"),
                    considerationItem.token.slice(2).padStart(64, "0"),
                    ethers.BigNumber.from(
                      considerationItem.identifierOrCriteria
                    )
                      .toHexString()
                      .slice(2)
                      .padStart(64, "0"),
                    ethers.BigNumber.from(considerationItem.startAmount)
                      .toHexString()
                      .slice(2)
                      .padStart(64, "0"),
                    ethers.BigNumber.from(considerationItem.endAmount)
                      .toHexString()
                      .slice(2)
                      .padStart(64, "0"),
                    considerationItem.recipient.slice(2).padStart(64, "0"),
                  ].join("")
              )
              .slice(2);
          })
          .join("")
    );

    const derivedOrderHash = ethers.utils.keccak256(
      "0x" +
        [
          orderTypeHash.slice(2),
          orderComponents.offerer.slice(2).padStart(64, "0"),
          orderComponents.zone.slice(2).padStart(64, "0"),
          offerHash.slice(2),
          considerationHash.slice(2),
          orderComponents.orderType.toString().padStart(64, "0"),
          ethers.BigNumber.from(orderComponents.startTime)
            .toHexString()
            .slice(2)
            .padStart(64, "0"),
          ethers.BigNumber.from(orderComponents.endTime)
            .toHexString()
            .slice(2)
            .padStart(64, "0"),
          orderComponents.zoneHash.slice(2),
          orderComponents.salt.slice(2).padStart(64, "0"),
          orderComponents.conduitKey.slice(2).padStart(64, "0"),
          ethers.BigNumber.from(orderComponents.nonce)
            .toHexString()
            .slice(2)
            .padStart(64, "0"),
        ].join("")
    );
    expect(orderHash).to.equal(derivedOrderHash);

    return orderHash;
  };

  // Returns signature
  const signOrder = async (orderComponents, signer) => {
    const signature = await signer._signTypedData(
      domainData,
      orderType,
      orderComponents
    );

    const orderHash = await getAndVerifyOrderHash(orderComponents);

    const { domainSeparator } = await marketplaceContract.information();
    const digest = ethers.utils.keccak256(
      `0x1901${domainSeparator.slice(2)}${orderHash.slice(2)}`
    );
    const recoveredAddress = ethers.utils.recoverAddress(digest, signature);

    expect(recoveredAddress).to.equal(signer.address);

    return signature;
  };

  const createOrder = async (
    offerer,
    zone,
    offer,
    consideration,
    orderType,
    criteriaResolvers,
    timeFlag,
    signer,
    zoneHash = constants.HashZero,
    conduitKey = constants.HashZero,
    extraCheap = false
  ) => {
    const nonce = await marketplaceContract.getNonce(offerer.address);

    const salt = !extraCheap ? randomHex() : constants.HashZero;
    const startTime =
      timeFlag !== "NOT_STARTED"
        ? 0
        : ethers.BigNumber.from("0xee00000000000000000000000000");
    const endTime =
      timeFlag !== "EXPIRED"
        ? ethers.BigNumber.from("0xff00000000000000000000000000")
        : 1;

    const orderParameters = {
      offerer: offerer.address,
      zone: !extraCheap ? zone.address : constants.AddressZero,
      offer,
      consideration,
      totalOriginalConsiderationItems: consideration.length,
      orderType,
      zoneHash,
      salt,
      conduitKey,
      startTime,
      endTime,
    };

    const orderComponents = {
      ...orderParameters,
      nonce,
    };

    const orderHash = await getAndVerifyOrderHash(orderComponents);

    const { isValidated, isCancelled, totalFilled, totalSize } =
      await marketplaceContract.getOrderStatus(orderHash);

    expect(isCancelled).to.equal(false);

    const orderStatus = {
      isValidated,
      isCancelled,
      totalFilled,
      totalSize,
    };

    const flatSig = await signOrder(orderComponents, signer || offerer);

    const order = {
      parameters: orderParameters,
      signature: !extraCheap ? flatSig : convertSignatureToEIP2098(flatSig),
      numerator: 1, // only used for advanced orders
      denominator: 1, // only used for advanced orders
      extraData: "0x", // only used for advanced orders
    };

    // How much ether (at most) needs to be supplied when fulfilling the order
    const value = offer
      .map((x) =>
        x.itemType === 0
          ? x.endAmount.gt(x.startAmount)
            ? x.endAmount
            : x.startAmount
          : ethers.BigNumber.from(0)
      )
      .reduce((a, b) => a.add(b), ethers.BigNumber.from(0))
      .add(
        consideration
          .map((x) =>
            x.itemType === 0
              ? x.endAmount.gt(x.startAmount)
                ? x.endAmount
                : x.startAmount
              : ethers.BigNumber.from(0)
          )
          .reduce((a, b) => a.add(b), ethers.BigNumber.from(0))
      );

    return {
      order,
      orderHash,
      value,
      orderStatus,
      orderComponents,
    };
  };

  const createMirrorBuyNowOrder = async (
    offerer,
    zone,
    order,
    conduitKey = constants.HashZero
  ) => {
    const nonce = await marketplaceContract.getNonce(offerer.address);
    const salt = randomHex();
    const startTime = order.parameters.startTime;
    const endTime = order.parameters.endTime;

    const compressedOfferItems = [];
    for (const {
      itemType,
      token,
      identifierOrCriteria,
      startAmount,
      endAmount,
    } of order.parameters.offer) {
      if (
        !compressedOfferItems
          .map((x) => `${x.itemType}+${x.token}+${x.identifierOrCriteria}`)
          .includes(`${itemType}+${token}+${identifierOrCriteria}`)
      ) {
        compressedOfferItems.push({
          itemType,
          token,
          identifierOrCriteria,
          startAmount: startAmount.eq(endAmount)
            ? startAmount
            : startAmount.sub(1),
          endAmount: startAmount.eq(endAmount) ? endAmount : endAmount.sub(1),
        });
      } else {
        const index = compressedOfferItems
          .map((x) => `${x.itemType}+${x.token}+${x.identifierOrCriteria}`)
          .indexOf(`${itemType}+${token}+${identifierOrCriteria}`);

        compressedOfferItems[index].startAmount = compressedOfferItems[
          index
        ].startAmount.add(
          startAmount.eq(endAmount) ? startAmount : startAmount.sub(1)
        );
        compressedOfferItems[index].endAmount = compressedOfferItems[
          index
        ].endAmount.add(
          startAmount.eq(endAmount) ? endAmount : endAmount.sub(1)
        );
      }
    }

    const compressedConsiderationItems = [];
    for (const {
      itemType,
      token,
      identifierOrCriteria,
      startAmount,
      endAmount,
      recipient,
    } of order.parameters.consideration) {
      if (
        !compressedConsiderationItems
          .map((x) => `${x.itemType}+${x.token}+${x.identifierOrCriteria}`)
          .includes(`${itemType}+${token}+${identifierOrCriteria}`)
      ) {
        compressedConsiderationItems.push({
          itemType,
          token,
          identifierOrCriteria,
          startAmount: startAmount.eq(endAmount)
            ? startAmount
            : startAmount.add(1),
          endAmount: startAmount.eq(endAmount) ? endAmount : endAmount.add(1),
          recipient,
        });
      } else {
        const index = compressedConsiderationItems
          .map((x) => `${x.itemType}+${x.token}+${x.identifierOrCriteria}`)
          .indexOf(`${itemType}+${token}+${identifierOrCriteria}`);

        compressedConsiderationItems[index].startAmount =
          compressedConsiderationItems[index].startAmount.add(
            startAmount.eq(endAmount) ? startAmount : startAmount.add(1)
          );
        compressedConsiderationItems[index].endAmount =
          compressedConsiderationItems[index].endAmount.add(
            startAmount.eq(endAmount) ? endAmount : endAmount.add(1)
          );
      }
    }

    const orderParameters = {
      offerer: offerer.address,
      zone: zone.address,
      offer: compressedConsiderationItems.map((x) => ({
        itemType: x.itemType,
        token: x.token,
        identifierOrCriteria: x.identifierOrCriteria,
        startAmount: x.startAmount,
        endAmount: x.endAmount,
      })),
      consideration: compressedOfferItems.map((x) => ({
        ...x,
        recipient: offerer.address,
      })),
      totalOriginalConsiderationItems: compressedOfferItems.length,
      orderType: order.parameters.orderType, // FULL_OPEN
      zoneHash: "0x".padEnd(66, "0"),
      salt,
      conduitKey,
      startTime,
      endTime,
    };

    const orderComponents = {
      ...orderParameters,
      nonce,
    };

    const flatSig = await signOrder(orderComponents, offerer);

    const mirrorOrderHash = await getAndVerifyOrderHash(orderComponents);

    const mirrorOrder = {
      parameters: orderParameters,
      signature: flatSig,
      numerator: order.numerator, // only used for advanced orders
      denominator: order.denominator, // only used for advanced orders
      extraData: "0x", // only used for advanced orders
    };

    // How much ether (at most) needs to be supplied when fulfilling the order
    const mirrorValue = orderParameters.consideration
      .map((x) =>
        x.itemType === 0
          ? x.endAmount.gt(x.startAmount)
            ? x.endAmount
            : x.startAmount
          : ethers.BigNumber.from(0)
      )
      .reduce((a, b) => a.add(b), ethers.BigNumber.from(0));

    return {
      mirrorOrder,
      mirrorOrderHash,
      mirrorValue,
    };
  };

  const createMirrorAcceptOfferOrder = async (
    offerer,
    zone,
    order,
    criteriaResolvers,
    conduitKey = constants.HashZero
  ) => {
    const nonce = await marketplaceContract.getNonce(offerer.address);
    const salt = randomHex();
    const startTime = order.parameters.startTime;
    const endTime = order.parameters.endTime;

    const orderParameters = {
      offerer: offerer.address,
      zone: zone.address,
      offer: order.parameters.consideration
        .filter((x) => x.itemType !== 1)
        .map((x) => ({
          itemType: x.itemType < 4 ? x.itemType : x.itemType - 2,
          token: x.token,
          identifierOrCriteria:
            x.itemType < 4
              ? x.identifierOrCriteria
              : criteriaResolvers[0].identifier,
          startAmount: x.startAmount,
          endAmount: x.endAmount,
        })),
      consideration: order.parameters.offer.map((x) => ({
        itemType: x.itemType < 4 ? x.itemType : x.itemType - 2,
        token: x.token,
        identifierOrCriteria:
          x.itemType < 4
            ? x.identifierOrCriteria
            : criteriaResolvers[0].identifier,
        recipient: offerer.address,
        startAmount: ethers.BigNumber.from(x.endAmount).sub(
          order.parameters.consideration
            .filter(
              (i) =>
                i.itemType < 2 &&
                i.itemType === x.itemType &&
                i.token === x.token
            )
            .map((i) => i.endAmount)
            .reduce((a, b) => a.add(b), ethers.BigNumber.from(0))
        ),
        endAmount: ethers.BigNumber.from(x.endAmount).sub(
          order.parameters.consideration
            .filter(
              (i) =>
                i.itemType < 2 &&
                i.itemType === x.itemType &&
                i.token === x.token
            )
            .map((i) => i.endAmount)
            .reduce((a, b) => a.add(b), ethers.BigNumber.from(0))
        ),
      })),
      totalOriginalConsiderationItems: order.parameters.offer.length,
      orderType: 0, // FULL_OPEN
      zoneHash: constants.HashZero,
      salt,
      conduitKey,
      startTime,
      endTime,
    };

    const orderComponents = {
      ...orderParameters,
      nonce,
    };

    const flatSig = await signOrder(orderComponents, offerer);

    const mirrorOrderHash = await getAndVerifyOrderHash(orderComponents);

    const mirrorOrder = {
      parameters: orderParameters,
      signature: flatSig,
      numerator: 1, // only used for advanced orders
      denominator: 1, // only used for advanced orders
      extraData: "0x", // only used for advanced orders
    };

    // How much ether (at most) needs to be supplied when fulfilling the order
    const mirrorValue = orderParameters.consideration
      .map((x) =>
        x.itemType === 0
          ? x.endAmount.gt(x.startAmount)
            ? x.endAmount
            : x.startAmount
          : ethers.BigNumber.from(0)
      )
      .reduce((a, b) => a.add(b), ethers.BigNumber.from(0));

    return {
      mirrorOrder,
      mirrorOrderHash,
      mirrorValue,
    };
  };

  const checkExpectedEvents = async (
    receipt,
    orderGroups,
    standardExecutions,
    criteriaResolvers,
    shouldSkipAmountComparison = false,
    multiplier = 1
  ) => {
    if (standardExecutions && standardExecutions.length > 0) {
      for (const standardExecution of standardExecutions) {
        const { item } = standardExecution;

        const { itemType, token, identifier, amount, recipient } = item;

        if (itemType !== 0) {
          const tokenEvents = receipt.events.filter((x) => x.address === token);

          expect(tokenEvents.length).to.be.above(0);

          if (itemType === 1) {
            // ERC20
            // search for transfer
            const transferLogs = tokenEvents
              .map((x) => testERC20.interface.parseLog(x))
              .filter(
                (x) =>
                  x.signature === "Transfer(address,address,uint256)" &&
                  x.args.to === recipient
              );

            expect(transferLogs.length > 0).to.be.true;
            const transferLog = transferLogs[0];
            expect(transferLog.args.amount.toString()).to.equal(
              amount.toString()
            );
          } else if (itemType === 2) {
            // ERC721
            // search for transfer
            const transferLogs = tokenEvents
              .map((x) => testERC721.interface.parseLog(x))
              .filter(
                (x) =>
                  x.signature === "Transfer(address,address,uint256)" &&
                  x.args.to === recipient
              );

            expect(transferLogs.length).to.equal(1);
            const transferLog = transferLogs[0];
            expect(transferLog.args.id.toString()).to.equal(
              identifier.toString()
            );
          } else if (itemType === 3) {
            // search for transfer
            const transferLogs = tokenEvents
              .map((x) => testERC1155.interface.parseLog(x))
              .filter(
                (x) =>
                  x.signature ===
                    "TransferSingle(address,address,address,uint256,uint256)" &&
                  x.args.to === recipient
              );

            expect(transferLogs.length > 0).to.be.true;

            let found = false;
            for (const transferLog of transferLogs) {
              if (
                transferLog.args.id.toString() === identifier.toString() &&
                transferLog.args.amount.toString() === amount.toString()
              ) {
                found = true;
                break;
              }
            }

            expect(found).to.be.true;
          } else {
            expect(false).to.be.true; // bad item type
          }
        }
      }

      // TODO: sum up executions and compare to orders to ensure that all the
      // items (or partially-filled items) are accounted for
    }

    if (criteriaResolvers) {
      for (const { orderIndex, side, index, identifier } of criteriaResolvers) {
        const itemType =
          orderGroups[orderIndex].order.parameters[
            side === 0 ? "offer" : "consideration"
          ][index].itemType;
        if (itemType < 4) {
          console.error("APPLYING CRITERIA TO NON-CRITERIA-BASED ITEM");
          process.exit(1);
        }

        orderGroups[orderIndex].order.parameters[
          side === 0 ? "offer" : "consideration"
        ][index].itemType = itemType - 2;
        orderGroups[orderIndex].order.parameters[
          side === 0 ? "offer" : "consideration"
        ][index].identifierOrCriteria = identifier;
      }
    }

    for (const { order, orderHash, fulfiller } of orderGroups) {
      const marketplaceContractEvents = receipt.events
        .filter((x) => x.address === marketplaceContract.address)
        .map((x) => ({
          eventName: x.event,
          eventSignature: x.eventSignature,
          orderHash: x.args.orderHash,
          offerer: x.args.offerer,
          zone: x.args.zone,
          fulfiller: x.args.fulfiller,
          offer: x.args.offer.map((y) => ({
            itemType: y.itemType,
            token: y.token,
            identifier: y.identifier,
            amount: y.amount,
          })),
          consideration: x.args.consideration.map((y) => ({
            itemType: y.itemType,
            token: y.token,
            identifier: y.identifier,
            amount: y.amount,
            recipient: y.recipient,
          })),
        }))
        .filter((x) => x.orderHash === orderHash);

      expect(marketplaceContractEvents.length).to.equal(1);

      const event = marketplaceContractEvents[0];

      expect(event.eventName).to.equal("OrderFulfilled");
      expect(event.eventSignature).to.equal(
        "OrderFulfilled(" +
          "bytes32,address,address,address,(" +
          "uint8,address,uint256,uint256)[],(" +
          "uint8,address,uint256,uint256,address)[])"
      );
      expect(event.orderHash).to.equal(orderHash);
      expect(event.offerer).to.equal(order.parameters.offerer);
      expect(event.zone).to.equal(order.parameters.zone);
      expect(event.fulfiller).to.equal(fulfiller);

      const compareEventItems = async (
        item,
        orderItem,
        isConsiderationItem
      ) => {
        expect(item.itemType).to.equal(
          orderItem.itemType > 3 ? orderItem.itemType - 2 : orderItem.itemType
        );
        expect(item.token).to.equal(orderItem.token);
        expect(item.token).to.equal(tokenByType[item.itemType].address);
        if (orderItem.itemType < 4) {
          // no criteria-based
          expect(item.identifier).to.equal(orderItem.identifierOrCriteria);
        } else {
          console.error("CRITERIA-BASED EVENT VALIDATION NOT MET");
          process.exit(1);
        }

        if (order.parameters.orderType === 0) {
          // FULL_OPEN (no partial fills)
          if (
            orderItem.startAmount.toString() === orderItem.endAmount.toString()
          ) {
            expect(item.amount.toString()).to.equal(
              orderItem.endAmount.toString()
            );
          } else {
            const { timestamp } = await provider.getBlock(receipt.blockHash);
            const duration = ethers.BigNumber.from(
              order.parameters.endTime
            ).sub(order.parameters.startTime);
            const elapsed = ethers.BigNumber.from(timestamp).sub(
              order.parameters.startTime
            );
            const remaining = duration.sub(elapsed);

            expect(item.amount.toString()).to.equal(
              ethers.BigNumber.from(orderItem.startAmount)
                .mul(remaining)
                .add(ethers.BigNumber.from(orderItem.endAmount).mul(elapsed))
                .add(isConsiderationItem ? duration.sub(1) : 0)
                .div(duration)
                .toString()
            );
          }
        } else {
          if (
            orderItem.startAmount.toString() === orderItem.endAmount.toString()
          ) {
            expect(item.amount.toString()).to.equal(
              orderItem.endAmount
                .mul(order.numerator)
                .div(order.denominator)
                .toString()
            );
          } else {
            console.error("SLIDING AMOUNT NOT IMPLEMENTED YET");
            process.exit(1);
          }
        }
      };

      expect(event.offer.length).to.equal(order.parameters.offer.length);
      for (const [index, offer] of Object.entries(event.offer)) {
        const offerItem = order.parameters.offer[index];
        await compareEventItems(offer, offerItem, false);

        const tokenEvents = receipt.events.filter(
          (x) => x.address === offerItem.token
        );

        if (offer.itemType === 1) {
          // ERC20
          // search for transfer
          const transferLogs = tokenEvents
            .map((x) => testERC20.interface.parseLog(x))
            .filter(
              (x) =>
                x.signature === "Transfer(address,address,uint256)" &&
                x.args.from === event.offerer &&
                (fulfiller !== constants.AddressZero
                  ? x.args.to === fulfiller
                  : true)
            );

          expect(transferLogs.length).to.be.above(0);
          for (const transferLog of transferLogs) {
            // TODO: check each transferred amount
          }
        } else if (offer.itemType === 2) {
          // ERC721
          // search for transfer
          const transferLogs = tokenEvents
            .map((x) => testERC721.interface.parseLog(x))
            .filter(
              (x) =>
                x.signature === "Transfer(address,address,uint256)" &&
                x.args.from === event.offerer &&
                (fulfiller !== constants.AddressZero
                  ? x.args.to === fulfiller
                  : true)
            );

          expect(transferLogs.length).to.equal(1);
          const transferLog = transferLogs[0];
          expect(transferLog.args.id.toString()).to.equal(
            offer.identifier.toString()
          );
        } else if (offer.itemType === 3) {
          // search for transfer
          const transferLogs = tokenEvents
            .map((x) => testERC1155.interface.parseLog(x))
            .filter(
              (x) =>
                (x.signature ===
                  "TransferSingle(address,address,address,uint256,uint256)" &&
                  x.args.from === event.offerer &&
                  (fulfiller !== constants.AddressZero
                    ? x.args.to === fulfiller
                    : true)) ||
                (x.signature ===
                  "TransferBatch(address,address,address,uint256[],uint256[])" &&
                  x.args.from === event.offerer &&
                  (fulfiller !== constants.AddressZero
                    ? x.args.to === fulfiller
                    : true))
            );

          expect(transferLogs.length > 0).to.be.true;

          let found = false;
          for (const transferLog of transferLogs) {
            if (
              transferLog.signature ===
                "TransferSingle(address,address,address,uint256,uint256)" &&
              transferLog.args.id.toString() === offer.identifier.toString() &&
              (shouldSkipAmountComparison ||
                transferLog.args.amount.toString() ===
                  offer.amount.mul(multiplier).toString())
            ) {
              found = true;
              break;
            }
          }

          expect(found).to.be.true;
        }
      }

      expect(event.consideration.length).to.equal(
        order.parameters.consideration.length
      );
      for (const [index, consideration] of Object.entries(
        event.consideration
      )) {
        const considerationItem = order.parameters.consideration[index];
        await compareEventItems(consideration, considerationItem, true);
        expect(consideration.recipient).to.equal(considerationItem.recipient);

        const tokenEvents = receipt.events.filter(
          (x) => x.address === considerationItem.token
        );

        if (consideration.itemType === 1) {
          // ERC20
          // search for transfer
          const transferLogs = tokenEvents
            .map((x) => testERC20.interface.parseLog(x))
            .filter(
              (x) =>
                x.signature === "Transfer(address,address,uint256)" &&
                x.args.to === consideration.recipient
            );

          expect(transferLogs.length).to.be.above(0);
          for (const transferLog of transferLogs) {
            // TODO: check each transferred amount
          }
        } else if (consideration.itemType === 2) {
          // ERC721
          // search for transfer

          const transferLogs = tokenEvents
            .map((x) => testERC721.interface.parseLog(x))
            .filter(
              (x) =>
                x.signature === "Transfer(address,address,uint256)" &&
                x.args.to === consideration.recipient
            );

          expect(transferLogs.length).to.equal(1);
          const transferLog = transferLogs[0];
          expect(transferLog.args.id.toString()).to.equal(
            consideration.identifier.toString()
          );
        } else if (consideration.itemType === 3) {
          // search for transfer
          const transferLogs = tokenEvents
            .map((x) => testERC1155.interface.parseLog(x))
            .filter(
              (x) =>
                (x.signature ===
                  "TransferSingle(address,address,address,uint256,uint256)" &&
                  x.args.to === consideration.recipient) ||
                (x.signature ===
                  "TransferBatch(address,address,address,uint256[],uint256[])" &&
                  x.args.to === consideration.recipient)
            );

          expect(transferLogs.length > 0).to.be.true;

          let found = false;
          for (const transferLog of transferLogs) {
            if (
              transferLog.signature ===
                "TransferSingle(address,address,address,uint256,uint256)" &&
              transferLog.args.id.toString() ===
                consideration.identifier.toString() &&
              (shouldSkipAmountComparison ||
                transferLog.args.amount.toString() ===
                  consideration.amount.mul(multiplier).toString())
            ) {
              found = true;
              break;
            }
          }

          expect(found).to.be.true;
        }
      }
    }
  };

  const defaultBuyNowMirrorFulfillment = [
    [[[0, 0]], [[1, 0]]],
    [[[1, 0]], [[0, 0]]],
    [[[1, 0]], [[0, 1]]],
    [[[1, 0]], [[0, 2]]],
  ].map(([offerArr, considerationArr]) =>
    toFulfillment(offerArr, considerationArr)
  );

  const defaultAcceptOfferMirrorFulfillment = [
    [[[1, 0]], [[0, 0]]],
    [[[0, 0]], [[1, 0]]],
    [[[0, 0]], [[0, 1]]],
    [[[0, 0]], [[0, 2]]],
  ].map(([offerArr, considerationArr]) =>
    toFulfillment(offerArr, considerationArr)
  );

  before(async () => {
    const network = await provider.getNetwork();

    chainId = network.chainId;

    owner = ethers.Wallet.createRandom().connect(provider);

    await Promise.all(
      [owner].map((wallet) => faucet(wallet.address, provider))
    );

    // Deploy keyless create2 deployer
    await faucet(deployConstants.KEYLESS_CREATE2_DEPLOYER_ADDRESS, provider);
    await provider.sendTransaction(
      deployConstants.KEYLESS_CREATE2_DEPLOYMENT_TRANSACTION
    );
    let deployedCode = await provider.getCode(
      deployConstants.KEYLESS_CREATE2_ADDRESS
    );
    expect(deployedCode).to.equal(deployConstants.KEYLESS_CREATE2_RUNTIME_CODE);

    // Deploy inefficient deployer through keyless
    await owner.sendTransaction({
      to: deployConstants.KEYLESS_CREATE2_ADDRESS,
      data: deployConstants.IMMUTABLE_CREATE2_FACTORY_CREATION_CODE,
    });
    deployedCode = await provider.getCode(
      deployConstants.INEFFICIENT_IMMUTABLE_CREATE2_FACTORY_ADDRESS
    );
    expect(ethers.utils.keccak256(deployedCode)).to.equal(
      deployConstants.IMMUTABLE_CREATE2_FACTORY_RUNTIME_HASH
    );

    const inefficientFactory = await ethers.getContractAt(
      "ImmutableCreate2FactoryInterface",
      deployConstants.INEFFICIENT_IMMUTABLE_CREATE2_FACTORY_ADDRESS,
      owner
    );

    // Deploy effecient deployer through inefficient deployer
    await inefficientFactory
      .connect(owner)
      .safeCreate2(
        deployConstants.IMMUTABLE_CREATE2_FACTORY_SALT,
        deployConstants.IMMUTABLE_CREATE2_FACTORY_CREATION_CODE
      );
    deployedCode = await provider.getCode(
      deployConstants.IMMUTABLE_CREATE2_FACTORY_ADDRESS
    );
    expect(ethers.utils.keccak256(deployedCode)).to.equal(
      deployConstants.IMMUTABLE_CREATE2_FACTORY_RUNTIME_HASH
    );
    const create2Factory = await ethers.getContractAt(
      "ImmutableCreate2FactoryInterface",
      deployConstants.IMMUTABLE_CREATE2_FACTORY_ADDRESS,
      owner
    );

    EIP1271WalletFactory = await ethers.getContractFactory("EIP1271Wallet");

    reenterer = await deployContract("Reenterer", owner);

    if (process.env.REFERENCE) {
      conduitImplementation = await ethers.getContractFactory(
        "ReferenceConduit"
      );
      conduitController = await deployContract("ConduitController", owner);
    } else {
      conduitImplementation = await ethers.getContractFactory("Conduit");

      // Deploy conduit controller through efficient create2 factory
      const conduitControllerFactory = await ethers.getContractFactory(
        "ConduitController"
      );

      const conduitControllerAddress = await create2Factory.findCreate2Address(
        ethers.constants.HashZero, // TODO: find a good one
        conduitControllerFactory.bytecode
      );

      await create2Factory.safeCreate2(
        ethers.constants.HashZero, // TODO: find a good one
        conduitControllerFactory.bytecode
      );

      conduitController = await ethers.getContractAt(
        "ConduitController",
        conduitControllerAddress,
        owner
      );
    }

    conduitKeyOne = `0x000000000000000000000000${owner.address.slice(2)}`;

    await conduitController.createConduit(conduitKeyOne, owner.address);

    const { conduit: conduitOneAddress, exists } =
      await conduitController.getConduit(conduitKeyOne);

    expect(exists).to.be.true;

    conduitOne = conduitImplementation.attach(conduitOneAddress);

    // Deploy marketplace contract through efficient create2 factory
    const marketplaceContractFactory = await ethers.getContractFactory(
      process.env.REFERENCE ? "ReferenceConsideration" : "Consideration"
    );

    const marketplaceContractAddress = await create2Factory.findCreate2Address(
      ethers.constants.HashZero, // TODO: find a good one
      marketplaceContractFactory.bytecode +
        conduitController.address.slice(2).padStart(64, "0")
    );

    let { gasLimit } = await provider.getBlock();

    if (process.env.REFERENCE) {
      gasLimit = ethers.BigNumber.from(300_000_000);
    }

    const tx = await create2Factory.safeCreate2(
      ethers.constants.HashZero, // TODO: find a good one
      marketplaceContractFactory.bytecode +
        conduitController.address.slice(2).padStart(64, "0"),
      {
        gasLimit,
      }
    );

    const { gasUsed } = await tx.wait(); // as of now: 5_479_569

    marketplaceContract = await ethers.getContractAt(
      process.env.REFERENCE ? "ReferenceConsideration" : "Consideration",
      marketplaceContractAddress,
      owner
    );

    await conduitController
      .connect(owner)
      .updateChannel(conduitOne.address, marketplaceContract.address, true);

    testERC20 = await deployContract("TestERC20", owner);
    testERC721 = await deployContract("TestERC721", owner);
    testERC1155 = await deployContract("TestERC1155", owner);
    testERC1155Two = await deployContract("TestERC1155", owner);

    stubZone = await deployContract("TestZone", owner);

    tokenByType = [
      {
        address: constants.AddressZero,
      }, // ETH
      testERC20,
      testERC721,
      testERC1155,
    ];

    // Required for EIP712 signing
    domainData = {
      name: "Consideration",
      version: VERSION,
      chainId: chainId,
      verifyingContract: marketplaceContract.address,
    };

    withBalanceChecks = async (
      ordersArray, // TODO: include order statuses to account for partial fills
      additonalPayouts,
      criteriaResolvers,
      fn,
      multiplier = 1
    ) => {
      const ordersClone = JSON.parse(JSON.stringify(ordersArray));
      for (const [i, order] of Object.entries(ordersClone)) {
        order.parameters.startTime = ordersArray[i].parameters.startTime;
        order.parameters.endTime = ordersArray[i].parameters.endTime;

        for (const [j, offerItem] of Object.entries(order.parameters.offer)) {
          offerItem.startAmount =
            ordersArray[i].parameters.offer[j].startAmount;
          offerItem.endAmount = ordersArray[i].parameters.offer[j].endAmount;
        }

        for (const [j, considerationItem] of Object.entries(
          order.parameters.consideration
        )) {
          considerationItem.startAmount =
            ordersArray[i].parameters.consideration[j].startAmount;
          considerationItem.endAmount =
            ordersArray[i].parameters.consideration[j].endAmount;
        }
      }

      if (criteriaResolvers) {
        for (const {
          orderIndex,
          side,
          index,
          identifier,
        } of criteriaResolvers) {
          const itemType =
            ordersClone[orderIndex].parameters[
              side === 0 ? "offer" : "consideration"
            ][index].itemType;
          if (itemType < 4) {
            console.error("APPLYING CRITERIA TO NON-CRITERIA-BASED ITEM");
            process.exit(1);
          }

          ordersClone[orderIndex].parameters[
            side === 0 ? "offer" : "consideration"
          ][index].itemType = itemType - 2;
          ordersClone[orderIndex].parameters[
            side === 0 ? "offer" : "consideration"
          ][index].identifierOrCriteria = identifier;
        }
      }

      const allOfferedItems = ordersClone
        .map((x) =>
          x.parameters.offer.map((offerItem) => ({
            ...offerItem,
            account: x.parameters.offerer,
            numerator: x.numerator,
            denominator: x.denominator,
            startTime: x.parameters.startTime,
            endTime: x.parameters.endTime,
          }))
        )
        .flat();

      const allReceivedItems = ordersClone
        .map((x) =>
          x.parameters.consideration.map((considerationItem) => ({
            ...considerationItem,
            numerator: x.numerator,
            denominator: x.denominator,
            startTime: x.parameters.startTime,
            endTime: x.parameters.endTime,
          }))
        )
        .flat();

      for (const offeredItem of allOfferedItems) {
        if (offeredItem.itemType > 3) {
          console.error("CRITERIA ON OFFERED ITEM NOT RESOLVED");
          process.exit(1);
        }

        if (offeredItem.itemType === 0) {
          // ETH
          offeredItem.initialBalance = await provider.getBalance(
            offeredItem.account
          );
        } else if (offeredItem.itemType === 3) {
          // ERC1155
          offeredItem.initialBalance = await tokenByType[
            offeredItem.itemType
          ].balanceOf(offeredItem.account, offeredItem.identifierOrCriteria);
        } else if (offeredItem.itemType < 4) {
          offeredItem.initialBalance = await tokenByType[
            offeredItem.itemType
          ].balanceOf(offeredItem.account);
        }

        if (offeredItem.itemType === 2) {
          // ERC721
          offeredItem.ownsItemBefore =
            (await tokenByType[offeredItem.itemType].ownerOf(
              offeredItem.identifierOrCriteria
            )) === offeredItem.account;
        }
      }

      for (const receivedItem of allReceivedItems) {
        if (receivedItem.itemType > 3) {
          console.error(
            "CRITERIA-BASED BALANCE RECEIVED CHECKS NOT IMPLEMENTED YET"
          );
          process.exit(1);
        }

        if (receivedItem.itemType === 0) {
          // ETH
          receivedItem.initialBalance = await provider.getBalance(
            receivedItem.recipient
          );
        } else if (receivedItem.itemType === 3) {
          // ERC1155
          receivedItem.initialBalance = await tokenByType[
            receivedItem.itemType
          ].balanceOf(
            receivedItem.recipient,
            receivedItem.identifierOrCriteria
          );
        } else {
          receivedItem.initialBalance = await tokenByType[
            receivedItem.itemType
          ].balanceOf(receivedItem.recipient);
        }

        if (receivedItem.itemType === 2) {
          // ERC721
          receivedItem.ownsItemBefore =
            (await tokenByType[receivedItem.itemType].ownerOf(
              receivedItem.identifierOrCriteria
            )) === receivedItem.recipient;
        }
      }

      const receipt = await fn();

      const from = receipt.from;
      const gasUsed = receipt.gasUsed;

      for (const offeredItem of allOfferedItems) {
        if (offeredItem.account === from && offeredItem.itemType === 0) {
          offeredItem.initialBalance = offeredItem.initialBalance.sub(gasUsed);
        }
      }

      for (const receivedItem of allReceivedItems) {
        if (receivedItem.recipient === from && receivedItem.itemType === 0) {
          receivedItem.initialBalance =
            receivedItem.initialBalance.sub(gasUsed);
        }
      }

      for (const offeredItem of allOfferedItems) {
        if (offeredItem.itemType > 3) {
          console.error("CRITERIA-BASED BALANCE OFFERED CHECKS NOT MET");
          process.exit(1);
        }

        if (offeredItem.itemType === 0) {
          // ETH
          offeredItem.finalBalance = await provider.getBalance(
            offeredItem.account
          );
        } else if (offeredItem.itemType === 3) {
          // ERC1155
          offeredItem.finalBalance = await tokenByType[
            offeredItem.itemType
          ].balanceOf(offeredItem.account, offeredItem.identifierOrCriteria);
        } else if (offeredItem.itemType < 3) {
          // TODO: criteria-based
          offeredItem.finalBalance = await tokenByType[
            offeredItem.itemType
          ].balanceOf(offeredItem.account);
        }

        if (offeredItem.itemType === 2) {
          // ERC721
          offeredItem.ownsItemAfter =
            (await tokenByType[offeredItem.itemType].ownerOf(
              offeredItem.identifierOrCriteria
            )) === offeredItem.account;
        }
      }

      for (const receivedItem of allReceivedItems) {
        if (receivedItem.itemType > 3) {
          console.error("CRITERIA-BASED BALANCE RECEIVED CHECKS NOT MET");
          process.exit(1);
        }

        if (receivedItem.itemType === 0) {
          // ETH
          receivedItem.finalBalance = await provider.getBalance(
            receivedItem.recipient
          );
        } else if (receivedItem.itemType === 3) {
          // ERC1155
          receivedItem.finalBalance = await tokenByType[
            receivedItem.itemType
          ].balanceOf(
            receivedItem.recipient,
            receivedItem.identifierOrCriteria
          );
        } else {
          receivedItem.finalBalance = await tokenByType[
            receivedItem.itemType
          ].balanceOf(receivedItem.recipient);
        }

        if (receivedItem.itemType === 2) {
          // ERC721
          receivedItem.ownsItemAfter =
            (await tokenByType[receivedItem.itemType].ownerOf(
              receivedItem.identifierOrCriteria
            )) === receivedItem.recipient;
        }
      }

      const { timestamp } = await provider.getBlock(receipt.blockHash);

      for (const offeredItem of allOfferedItems) {
        const duration = ethers.BigNumber.from(offeredItem.endTime).sub(
          offeredItem.startTime
        );
        const elapsed = ethers.BigNumber.from(timestamp).sub(
          offeredItem.startTime
        );
        const remaining = duration.sub(elapsed);

        if (offeredItem.itemType < 4) {
          // TODO: criteria-based
          if (!additonalPayouts) {
            expect(
              offeredItem.initialBalance
                .sub(offeredItem.finalBalance)
                .toString()
            ).to.equal(
              ethers.BigNumber.from(offeredItem.startAmount)
                .mul(remaining)
                .add(ethers.BigNumber.from(offeredItem.endAmount).mul(elapsed))
                .div(duration)
                .mul(offeredItem.numerator)
                .div(offeredItem.denominator)
                .mul(multiplier)
                .toString()
            );
          } else {
            expect(
              offeredItem.initialBalance
                .sub(offeredItem.finalBalance)
                .toString()
            ).to.equal(additonalPayouts.add(offeredItem.endAmount).toString());
          }
        }

        if (offeredItem.itemType === 2) {
          // ERC721
          expect(offeredItem.ownsItemBefore).to.equal(true);
          expect(offeredItem.ownsItemAfter).to.equal(false);
        }
      }

      for (const receivedItem of allReceivedItems) {
        const duration = ethers.BigNumber.from(receivedItem.endTime).sub(
          receivedItem.startTime
        );
        const elapsed = ethers.BigNumber.from(timestamp).sub(
          receivedItem.startTime
        );
        const remaining = duration.sub(elapsed);

        expect(
          receivedItem.finalBalance.sub(receivedItem.initialBalance).toString()
        ).to.equal(
          ethers.BigNumber.from(receivedItem.startAmount)
            .mul(remaining)
            .add(ethers.BigNumber.from(receivedItem.endAmount).mul(elapsed))
            .add(duration.sub(1))
            .div(duration)
            .mul(receivedItem.numerator)
            .div(receivedItem.denominator)
            .mul(multiplier)
            .toString()
        );

        if (receivedItem.itemType === 2) {
          // ERC721
          expect(receivedItem.ownsItemBefore).to.equal(false);
          expect(receivedItem.ownsItemAfter).to.equal(true);
        }
      }

      return receipt;
    };

    simulateMatchOrders = async (orders, fulfillments, caller, value) => {
      return marketplaceContract
        .connect(caller)
        .callStatic.matchOrders(orders, fulfillments, {
          value,
        });
    };

    simulateAdvancedMatchOrders = async (
      orders,
      criteriaResolvers,
      fulfillments,
      caller,
      value
    ) => {
      return marketplaceContract
        .connect(caller)
        .callStatic.matchAdvancedOrders(
          orders,
          criteriaResolvers,
          fulfillments,
          {
            value,
          }
        );
    };
  });

  describe("Getter tests", async () => {
    it("gets correct name", async () => {
      const name = await marketplaceContract.name();
      expect(name).to.equal("Consideration");
    });
    it("gets correct version, domain separator and conduit controller", async () => {
      const name = "Consideration";
      const {
        version,
        domainSeparator,
        conduitController: controller,
      } = await marketplaceContract.information();

      const typehash = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes(
          "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        )
      );
      const namehash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(name));
      const versionhash = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes(version)
      );
      const { chainId } = await provider.getNetwork();
      const chainIdEncoded = chainId.toString(16).padStart(64, "0");
      const addressEncoded = marketplaceContract.address
        .slice(2)
        .padStart(64, "0");
      expect(domainSeparator).to.equal(
        ethers.utils.keccak256(
          `0x${typehash.slice(2)}${namehash.slice(2)}${versionhash.slice(
            2
          )}${chainIdEncoded}${addressEncoded}`
        )
      );
      expect(controller).to.equal(conduitController.address);
    });
  });

  // Buy now or accept offer for a single ERC721 or ERC1155 in exchange for
  // ETH, WETH or ERC20
  describe("Basic buy now or accept offer flows", async () => {
    let seller;
    let sellerContract;
    let buyerContract;
    let buyer;

    beforeEach(async () => {
      // Setup basic buyer/seller wallets with ETH
      seller = ethers.Wallet.createRandom().connect(provider);
      buyer = ethers.Wallet.createRandom().connect(provider);
      zone = ethers.Wallet.createRandom().connect(provider);

      sellerContract = await EIP1271WalletFactory.deploy(seller.address);
      buyerContract = await EIP1271WalletFactory.deploy(buyer.address);

      await Promise.all(
        [seller, buyer, zone, sellerContract, buyerContract].map((wallet) =>
          faucet(wallet.address, provider)
        )
      );
    });

    describe("A single ERC721 is to be transferred", async () => {
      describe("[Buy now] User fullfills a sell order for a single ERC721", async () => {
        it("ERC721 <=> ETH (standard)", async () => {
          const nftId = await mintAndApprove721(
            seller,
            marketplaceContract.address
          );

          const offer = [getTestItem721(nftId)];

          const consideration = [
            getItemETH(10, 10, seller.address),
            getItemETH(1, 1, zone.address),
            getItemETH(1, 1, owner.address),
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0 // FULL_OPEN
          );

          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, toKey(false), {
                value,
              });
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC721 <=> ETH (standard via conduit)", async () => {
          const nftId = await mintAndApprove721(seller, conduitOne.address);

          const offer = [getTestItem721(nftId)];

          const consideration = [
            getItemETH(10, 10, seller.address),
            getItemETH(1, 1, zone.address),
            getItemETH(1, 1, owner.address),
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0, // FULL_OPEN
            [],
            null,
            seller,
            constants.HashZero,
            conduitKeyOne
          );

          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, toKey(false), {
                value,
              });
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC721 <=> ETH (standard with tip)", async () => {
          const nftId = await mintAndApprove721(
            seller,
            marketplaceContract.address
          );

          const offer = [getTestItem721(nftId)];

          const consideration = [
            getItemETH(10, 10, seller.address),
            getItemETH(1, 1, zone.address),
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0 // FULL_OPEN
          );

          // Add a tip
          order.parameters.consideration.push(getItemETH(1, 1, owner.address));

          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, toKey(false), {
                value: value.add(ethers.utils.parseEther("1")),
              });
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC721 <=> ETH (standard with restricted order)", async () => {
          const nftId = await mintAndApprove721(
            seller,
            marketplaceContract.address
          );

          const offer = [getTestItem721(nftId)];

          const consideration = [
            getItemETH(10, 10, seller.address),
            getItemETH(1, 1, zone.address),
            getItemETH(1, 1, owner.address),
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            stubZone,
            offer,
            consideration,
            2 // FULL_RESTRICTED
          );

          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, toKey(false), {
                value,
              });
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC721 <=> ETH (standard with restricted order and extra data)", async () => {
          const nftId = await mintAndApprove721(
            seller,
            marketplaceContract.address
          );

          const offer = [getTestItem721(nftId)];

          const consideration = [
            getItemETH(10, 10, seller.address),
            getItemETH(1, 1, zone.address),
            getItemETH(1, 1, owner.address),
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            stubZone,
            offer,
            consideration,
            2 // FULL_RESTRICTED
          );

          order.extraData = "0x1234";

          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillAdvancedOrder(order, [], toKey(false), {
                value,
              });
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC721 <=> ETH (basic)", async () => {
          const nftId = await mintAndApprove721(
            seller,
            marketplaceContract.address
          );

          const offer = [getTestItem721(nftId)];

          const consideration = [
            getItemETH(10, 10, seller.address),
            getItemETH(1, 1, zone.address),
            getItemETH(1, 1, owner.address),
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0 // FULL_OPEN
          );

          const basicOrderParameters = getBasicOrderParameters(
            0, // EthForERC721
            order
          );
          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillBasicOrder(basicOrderParameters, {
                value,
              });
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC721 <=> ETH (basic, minimal and listed off-chain)", async () => {
          // Seller mints nft
          const nftId = await mintAndApprove721(
            seller,
            marketplaceContract.address
          );

          const offer = [getTestItem721(nftId)];

          const consideration = [
            {
              itemType: 0, // ETH
              token: constants.AddressZero,
              identifierOrCriteria: 0, // ignored for ETH
              startAmount: ethers.BigNumber.from(1),
              endAmount: ethers.BigNumber.from(1),
              recipient: seller.address,
            },
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            constants.AddressZero,
            offer,
            consideration,
            0, // FULL_OPEN
            [],
            null,
            seller,
            constants.HashZero,
            constants.HashZero,
            true // extraCheap
          );

          const basicOrderParameters = getBasicOrderParameters(
            0, // EthForERC721
            order
          );

          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillBasicOrder(basicOrderParameters, {
                value,
              });
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC721 <=> ETH (basic, minimal and verified on-chain)", async () => {
          // Seller mints nft
          const nftId = await mintAndApprove721(
            seller,
            marketplaceContract.address
          );

          const offer = [getTestItem721(nftId)];

          const consideration = [
            {
              itemType: 0, // ETH
              token: constants.AddressZero,
              identifierOrCriteria: 0, // ignored for ETH
              startAmount: ethers.BigNumber.from(1),
              endAmount: ethers.BigNumber.from(1),
              recipient: seller.address,
            },
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            constants.AddressZero,
            offer,
            consideration,
            0, // FULL_OPEN
            [],
            null,
            seller,
            constants.HashZero,
            constants.HashZero,
            true // extraCheap
          );

          // Validate the order from any account
          await expect(marketplaceContract.connect(owner).validate([order]))
            .to.emit(marketplaceContract, "OrderValidated")
            .withArgs(orderHash, seller.address, constants.AddressZero);

          const basicOrderParameters = getBasicOrderParameters(
            0, // EthForERC721
            order
          );

          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillBasicOrder(basicOrderParameters, {
                value,
              });
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC721 <=> ETH (standard, minimal and listed off-chain)", async () => {
          // Seller mints nft
          const nftId = await mintAndApprove721(
            seller,
            marketplaceContract.address
          );

          const offer = [getTestItem721(nftId)];

          const consideration = [
            {
              itemType: 0, // ETH
              token: constants.AddressZero,
              identifierOrCriteria: 0, // ignored for ETH
              startAmount: ethers.BigNumber.from(1),
              endAmount: ethers.BigNumber.from(1),
              recipient: seller.address,
            },
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            constants.AddressZero,
            offer,
            consideration,
            0, // FULL_OPEN
            [],
            null,
            seller,
            constants.HashZero,
            constants.HashZero,
            true // extraCheap
          );

          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, toKey(false), {
                value,
              });
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC721 <=> ETH (standard, minimal and verified on-chain)", async () => {
          // Seller mints nft
          const nftId = await mintAndApprove721(
            seller,
            marketplaceContract.address
          );

          const offer = [getTestItem721(nftId)];

          const consideration = [
            {
              itemType: 0, // ETH
              token: constants.AddressZero,
              identifierOrCriteria: 0, // ignored for ETH
              startAmount: ethers.BigNumber.from(1),
              endAmount: ethers.BigNumber.from(1),
              recipient: seller.address,
            },
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            constants.AddressZero,
            offer,
            consideration,
            0, // FULL_OPEN
            [],
            null,
            seller,
            constants.HashZero,
            constants.HashZero,
            true // extraCheap
          );

          // Validate the order from any account
          await expect(marketplaceContract.connect(owner).validate([order]))
            .to.emit(marketplaceContract, "OrderValidated")
            .withArgs(orderHash, seller.address, constants.AddressZero);

          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, toKey(false), {
                value,
              });
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC721 <=> ETH (advanced, minimal and listed off-chain)", async () => {
          // Seller mints nft
          const nftId = await mintAndApprove721(
            seller,
            marketplaceContract.address
          );

          const offer = [getTestItem721(nftId)];

          const consideration = [
            {
              itemType: 0, // ETH
              token: constants.AddressZero,
              identifierOrCriteria: 0, // ignored for ETH
              startAmount: ethers.BigNumber.from(1),
              endAmount: ethers.BigNumber.from(1),
              recipient: seller.address,
            },
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            constants.AddressZero,
            offer,
            consideration,
            0, // FULL_OPEN
            [],
            null,
            seller,
            constants.HashZero,
            constants.HashZero,
            true // extraCheap
          );

          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillAdvancedOrder(order, [], toKey(false), {
                value,
              });
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC721 <=> ETH (advanced, minimal and verified on-chain)", async () => {
          // Seller mints nft
          const nftId = await mintAndApprove721(
            seller,
            marketplaceContract.address
          );

          const offer = [getTestItem721(nftId)];

          const consideration = [
            {
              itemType: 0, // ETH
              token: constants.AddressZero,
              identifierOrCriteria: 0, // ignored for ETH
              startAmount: ethers.BigNumber.from(1),
              endAmount: ethers.BigNumber.from(1),
              recipient: seller.address,
            },
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            constants.AddressZero,
            offer,
            consideration,
            0, // FULL_OPEN
            [],
            null,
            seller,
            constants.HashZero,
            constants.HashZero,
            true // extraCheap
          );

          // Validate the order from any account
          await expect(marketplaceContract.connect(owner).validate([order]))
            .to.emit(marketplaceContract, "OrderValidated")
            .withArgs(orderHash, seller.address, constants.AddressZero);

          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillAdvancedOrder(order, [], toKey(false), {
                value,
              });
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC721 <=> ETH (basic with tips)", async () => {
          const nftId = await mintAndApprove721(
            seller,
            marketplaceContract.address
          );

          const offer = [getTestItem721(nftId)];

          const consideration = [
            getItemETH(10, 10, seller.address),
            getItemETH(1, 1, zone.address),
            getItemETH(1, 1, owner.address),
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0 // FULL_OPEN
          );

          const basicOrderParameters = getBasicOrderParameters(
            0, // EthForERC721
            order,
            false,
            [
              {
                amount: ethers.utils.parseEther("2"),
                recipient: `0x0000000000000000000000000000000000000001`,
              },
              {
                amount: ethers.utils.parseEther("3"),
                recipient: `0x0000000000000000000000000000000000000002`,
              },
              {
                amount: ethers.utils.parseEther("4"),
                recipient: `0x0000000000000000000000000000000000000003`,
              },
            ]
          );

          order.parameters.consideration.push(
            getItemETH(2, 2, "0x0000000000000000000000000000000000000001")
          );

          order.parameters.consideration.push(
            getItemETH(3, 3, "0x0000000000000000000000000000000000000002")
          );

          order.parameters.consideration.push(
            getItemETH(4, 4, "0x0000000000000000000000000000000000000003")
          );

          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillBasicOrder(basicOrderParameters, {
                value: value.add(ethers.utils.parseEther("9")),
              });
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC721 <=> ETH (basic via conduit)", async () => {
          const nftId = await mintAndApprove721(seller, conduitOne.address);

          const offer = [getTestItem721(nftId)];

          const consideration = [
            getItemETH(10, 10, seller.address),
            getItemETH(1, 1, zone.address),
            getItemETH(1, 1, owner.address),
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0, // FULL_OPEN
            [],
            null,
            seller,
            constants.HashZero,
            conduitKeyOne
          );

          const basicOrderParameters = getBasicOrderParameters(
            0, // EthForERC721
            order
          );

          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillBasicOrder(basicOrderParameters, {
                value,
              });
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC721 <=> ETH (basic with restricted order)", async () => {
          const nftId = await mintAndApprove721(
            seller,
            marketplaceContract.address
          );

          const offer = [getTestItem721(nftId)];

          const consideration = [
            getItemETH(10, 10, seller.address),
            getItemETH(1, 1, zone.address),
            getItemETH(1, 1, owner.address),
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            stubZone,
            offer,
            consideration,
            2 // FULL_RESTRICTED
          );

          const basicOrderParameters = getBasicOrderParameters(
            0, // EthForERC721
            order
          );

          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillBasicOrder(basicOrderParameters, {
                value,
              });
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC721 <=> ETH (basic with partial restricted order)", async () => {
          // Seller mints nft
          const nftId = ethers.BigNumber.from(randomHex());
          await testERC721.mint(seller.address, nftId);

          // Seller approves marketplace contract to transfer NFT
          await whileImpersonating(seller.address, provider, async () => {
            await expect(
              testERC721
                .connect(seller)
                .setApprovalForAll(marketplaceContract.address, true)
            )
              .to.emit(testERC721, "ApprovalForAll")
              .withArgs(seller.address, marketplaceContract.address, true);
          });

          const offer = [getTestItem721(nftId)];

          const consideration = [
            {
              itemType: 0, // ETH
              token: constants.AddressZero,
              identifierOrCriteria: 0, // ignored for ETH
              startAmount: ethers.utils.parseEther("10"),
              endAmount: ethers.utils.parseEther("10"),
              recipient: seller.address,
            },
            {
              itemType: 0, // ETH
              token: constants.AddressZero,
              identifierOrCriteria: 0, // ignored for ETH
              startAmount: ethers.utils.parseEther("1"),
              endAmount: ethers.utils.parseEther("1"),
              recipient: zone.address,
            },
            {
              itemType: 0, // ETH
              token: constants.AddressZero,
              identifierOrCriteria: 0, // ignored for ETH
              startAmount: ethers.utils.parseEther("1"),
              endAmount: ethers.utils.parseEther("1"),
              recipient: owner.address,
            },
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            stubZone,
            offer,
            consideration,
            3 // PARTIAL_RESTRICTED
          );

          const basicOrderParameters = getBasicOrderParameters(
            0, // EthForERC721
            order
          );

          await whileImpersonating(buyer.address, provider, async () => {
            await withBalanceChecks([order], 0, null, async () => {
              const tx = await marketplaceContract
                .connect(buyer)
                .fulfillBasicOrder(basicOrderParameters, { value });
              const receipt = await tx.wait();
              await checkExpectedEvents(receipt, [
                { order, orderHash, fulfiller: buyer.address },
              ]);
              return receipt;
            });
          });
        });
        it("ERC721 <=> ETH (basic, already validated)", async () => {
          const nftId = await mintAndApprove721(
            seller,
            marketplaceContract.address
          );

          const offer = [getTestItem721(nftId)];

          const consideration = [
            getItemETH(10, 10, seller.address),
            getItemETH(1, 1, zone.address),
            getItemETH(1, 1, owner.address),
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0 // FULL_OPEN
          );

          // Validate the order from any account
          await expect(marketplaceContract.connect(owner).validate([order]))
            .to.emit(marketplaceContract, "OrderValidated")
            .withArgs(orderHash, seller.address, zone.address);

          const basicOrderParameters = getBasicOrderParameters(
            0, // EthForERC721
            order
          );

          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillBasicOrder(basicOrderParameters, {
                value,
              });
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC721 <=> ETH (basic, EIP-2098 signature)", async () => {
          const nftId = await mintAndApprove721(
            seller,
            marketplaceContract.address
          );

          const offer = [getTestItem721(nftId)];

          const consideration = [
            getItemETH(10, 10, seller.address),
            getItemETH(1, 1, zone.address),
            getItemETH(1, 1, owner.address),
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0 // FULL_OPEN
          );

          // Convert signature to EIP 2098
          expect(order.signature.length).to.equal(132);
          order.signature = convertSignatureToEIP2098(order.signature);
          expect(order.signature.length).to.equal(130);

          const basicOrderParameters = getBasicOrderParameters(
            0, // EthForERC721
            order
          );

          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillBasicOrder(basicOrderParameters, {
                value,
              });
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC721 <=> ETH (basic, extra ether supplied and returned to caller)", async () => {
          const nftId = await mintAndApprove721(
            seller,
            marketplaceContract.address
          );

          const offer = [getTestItem721(nftId)];

          const consideration = [
            getItemETH(10, 10, seller.address),
            getItemETH(1, 1, zone.address),
            getItemETH(1, 1, owner.address),
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0 // FULL_OPEN
          );

          const basicOrderParameters = getBasicOrderParameters(
            0, // EthForERC721
            order
          );

          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillBasicOrder(basicOrderParameters, {
                value: value.add(1),
              });
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC721 <=> ETH (match)", async () => {
          const nftId = await mintAndApprove721(
            seller,
            marketplaceContract.address
          );

          const offer = [getTestItem721(nftId)];

          const consideration = [
            getItemETH(10, 10, seller.address),
            getItemETH(1, 1, zone.address),
            getItemETH(1, 1, owner.address),
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0 // FULL_OPEN
          );

          const { mirrorOrder, mirrorOrderHash } =
            await createMirrorBuyNowOrder(buyer, zone, order);

          const fulfillments = defaultBuyNowMirrorFulfillment;

          const executions = await simulateMatchOrders(
            [order, mirrorOrder],
            fulfillments,
            owner,
            value
          );
          expect(executions.length).to.equal(4);

          const tx = await marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments, {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          await checkExpectedEvents(
            receipt,
            [
              {
                order: mirrorOrder,
                orderHash: mirrorOrderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          return receipt;
        });
        it("ERC721 <=> ETH (match via conduit)", async () => {
          const nftId = await mintAndApprove721(seller, conduitOne.address);

          const offer = [getTestItem721(nftId)];

          const consideration = [
            getItemETH(10, 10, seller.address),
            getItemETH(1, 1, zone.address),
            getItemETH(1, 1, owner.address),
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0, // FULL_OPEN
            [],
            null,
            seller,
            constants.HashZero,
            conduitKeyOne
          );

          const { mirrorOrder, mirrorOrderHash } =
            await createMirrorBuyNowOrder(buyer, zone, order);

          const fulfillments = defaultBuyNowMirrorFulfillment;

          const executions = await simulateMatchOrders(
            [order, mirrorOrder],
            fulfillments,
            owner,
            value
          );

          expect(executions.length).to.equal(4);

          const tx = await marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments, {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          await checkExpectedEvents(
            receipt,
            [
              {
                order: mirrorOrder,
                orderHash: mirrorOrderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          return receipt;
        });
        it("ERC721 <=> ETH (match, extra eth supplied and returned to caller)", async () => {
          const nftId = await mintAndApprove721(
            seller,
            marketplaceContract.address
          );

          const offer = [getTestItem721(nftId)];

          const consideration = [
            getItemETH(10, 10, seller.address),
            getItemETH(1, 1, zone.address),
            getItemETH(1, 1, owner.address),
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0 // FULL_OPEN
          );

          const { mirrorOrder, mirrorOrderHash } =
            await createMirrorBuyNowOrder(buyer, zone, order);

          const fulfillments = defaultBuyNowMirrorFulfillment;

          const executions = await simulateMatchOrders(
            [order, mirrorOrder],
            fulfillments,
            owner,
            value
          );

          expect(executions.length).to.equal(4);

          const tx = await marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments, {
              value: value.add(101),
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          await checkExpectedEvents(
            receipt,
            [
              {
                order: mirrorOrder,
                orderHash: mirrorOrderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          return receipt;
        });
        it("ERC721 <=> ERC20 (standard)", async () => {
          const nftId = await mintAndApprove721(
            seller,
            marketplaceContract.address
          );

          // Buyer mints ERC20
          const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);
          await mintAndApproveERC20(
            buyer,
            marketplaceContract.address,
            tokenAmount
          );

          const offer = [getTestItem721(nftId)];

          const consideration = [
            getTestItem20(
              tokenAmount.sub(100),
              tokenAmount.sub(100),
              seller.address
            ),
            getTestItem20(50, 50, zone.address),
            getTestItem20(50, 50, owner.address),
          ];

          const { order, orderHash } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0 // FULL_OPEN
          );

          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, toKey(false));
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC721 <=> ERC20 (standard via conduit)", async () => {
          const nftId = await mintAndApprove721(seller, conduitOne.address);

          // Buyer mints ERC20
          const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);
          await mintAndApproveERC20(
            buyer,
            marketplaceContract.address,
            tokenAmount
          );

          const offer = [getTestItem721(nftId)];

          const consideration = [
            getTestItem20(
              tokenAmount.sub(100),
              tokenAmount.sub(100),
              seller.address
            ),
            getTestItem20(50, 50, zone.address),
            getTestItem20(50, 50, owner.address),
          ];

          const { order, orderHash } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0, // FULL_OPEN
            [],
            null,
            seller,
            constants.HashZero,
            conduitKeyOne
          );

          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, toKey(false));
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC721 <=> ERC20 (basic)", async () => {
          const nftId = await mintAndApprove721(
            seller,
            marketplaceContract.address
          );

          // Buyer mints ERC20
          const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);
          await mintAndApproveERC20(
            buyer,
            marketplaceContract.address,
            tokenAmount
          );

          const offer = [getTestItem721(nftId)];

          const consideration = [
            getTestItem20(
              tokenAmount.sub(100),
              tokenAmount.sub(100),
              seller.address
            ),
            getTestItem20(50, 50, zone.address),
            getTestItem20(50, 50, owner.address),
          ];

          const { order, orderHash } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0 // FULL_OPEN
          );

          const basicOrderParameters = getBasicOrderParameters(
            2, // ERC20ForERC721
            order
          );

          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillBasicOrder(basicOrderParameters);
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC721 <=> ERC20 (basic via conduit)", async () => {
          const nftId = await mintAndApprove721(seller, conduitOne.address);

          // Buyer mints ERC20
          const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);
          await mintAndApproveERC20(
            buyer,
            marketplaceContract.address,
            tokenAmount
          );

          const offer = [getTestItem721(nftId)];

          const consideration = [
            getTestItem20(
              tokenAmount.sub(100),
              tokenAmount.sub(100),
              seller.address
            ),
            getTestItem20(50, 50, zone.address),
            getTestItem20(50, 50, owner.address),
          ];

          const { order, orderHash } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0, // FULL_OPEN
            [],
            null,
            seller,
            constants.HashZero,
            conduitKeyOne
          );

          const basicOrderParameters = getBasicOrderParameters(
            2, // ERC20ForERC721
            order
          );

          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillBasicOrder(basicOrderParameters);
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC721 <=> ERC20 (basic, EIP-1271 signature)", async () => {
          // Seller mints nft to contract
          const nftId = ethers.BigNumber.from(randomHex());
          await testERC721.mint(sellerContract.address, nftId);

          // Seller approves marketplace contract to transfer NFT
          await expect(
            sellerContract
              .connect(seller)
              .approveNFT(testERC721.address, marketplaceContract.address)
          )
            .to.emit(testERC721, "ApprovalForAll")
            .withArgs(
              sellerContract.address,
              marketplaceContract.address,
              true
            );

          // Buyer mints ERC20
          const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);
          await mintAndApproveERC20(
            buyer,
            marketplaceContract.address,
            tokenAmount
          );

          const offer = [getTestItem721(nftId)];

          const consideration = [
            getTestItem20(
              tokenAmount.sub(100),
              tokenAmount.sub(100),
              sellerContract.address
            ),
            getTestItem20(50, 50, zone.address),
            getTestItem20(50, 50, owner.address),
          ];

          const { order, orderHash } = await createOrder(
            sellerContract,
            zone,
            offer,
            consideration,
            0, // FULL_OPEN
            [],
            null,
            seller
          );

          const basicOrderParameters = getBasicOrderParameters(
            2, // ERC20ForERC721
            order
          );

          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillBasicOrder(basicOrderParameters);
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC721 <=> ERC20 (basic, EIP-1271 signature w/ non-standard length)", async () => {
          // Seller mints nft to contract
          const nftId = ethers.BigNumber.from(randomHex());
          await testERC721.mint(sellerContract.address, nftId);

          // Seller approves marketplace contract to transfer NFT
          await expect(
            sellerContract
              .connect(seller)
              .approveNFT(testERC721.address, marketplaceContract.address)
          )
            .to.emit(testERC721, "ApprovalForAll")
            .withArgs(
              sellerContract.address,
              marketplaceContract.address,
              true
            );

          // Buyer mints ERC20
          const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);
          await mintAndApproveERC20(
            buyer,
            marketplaceContract.address,
            tokenAmount
          );

          const offer = [getTestItem721(nftId)];

          const consideration = [
            getTestItem20(
              tokenAmount.sub(100),
              tokenAmount.sub(100),
              sellerContract.address
            ),
            getTestItem20(50, 50, zone.address),
            getTestItem20(50, 50, owner.address),
          ];

          const { order, orderHash } = await createOrder(
            sellerContract,
            zone,
            offer,
            consideration,
            0, // FULL_OPEN
            [],
            null,
            seller
          );

          const basicOrderParameters = {
            ...getBasicOrderParameters(
              2, // ERC20ForERC721
              order
            ),
            signature: "0x",
          };

          // Fails before seller contract approves the digest (note that any
          // non-standard signature length is treated as a contract signature)
          if (!process.env.REFERENCE) {
            await expect(
              marketplaceContract
                .connect(buyer)
                .fulfillBasicOrder(basicOrderParameters)
            ).to.be.revertedWith("BadContractSignature");
          } else {
            await expect(
              marketplaceContract
                .connect(buyer)
                .fulfillBasicOrder(basicOrderParameters)
            ).to.be.reverted;
          }

          // Compute the digest based on the order hash
          const { domainSeparator } = await marketplaceContract.information();
          const digest = ethers.utils.keccak256(
            `0x1901${domainSeparator.slice(2)}${orderHash.slice(2)}`
          );

          // Seller approves the digest
          await sellerContract.connect(seller).registerDigest(digest, true);

          // Now it succeeds
          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillBasicOrder(basicOrderParameters);
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC721 <=> ERC20 (match)", async () => {
          const nftId = await mintAndApprove721(
            seller,
            marketplaceContract.address
          );

          // Buyer mints ERC20
          const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);
          await mintAndApproveERC20(
            buyer,
            marketplaceContract.address,
            tokenAmount
          );

          const offer = [getTestItem721(nftId)];

          const consideration = [
            getTestItem20(
              tokenAmount.sub(100),
              tokenAmount.sub(100),
              seller.address
            ),
            getTestItem20(50, 50, zone.address),
            getTestItem20(50, 50, owner.address),
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0 // FULL_OPEN
          );

          const { mirrorOrder, mirrorOrderHash } =
            await createMirrorBuyNowOrder(buyer, zone, order);

          const fulfillments = defaultBuyNowMirrorFulfillment;

          const executions = await simulateMatchOrders(
            [order, mirrorOrder],
            fulfillments,
            owner,
            value
          );

          expect(executions.length).to.equal(4);

          const tx = await marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments);
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          await checkExpectedEvents(
            receipt,
            [
              {
                order: mirrorOrder,
                orderHash: mirrorOrderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          return receipt;
        });
        it("ERC721 <=> ERC20 (match via conduit)", async () => {
          const nftId = await mintAndApprove721(seller, conduitOne.address);

          // Buyer mints ERC20
          const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);
          await mintAndApproveERC20(
            buyer,
            marketplaceContract.address,
            tokenAmount
          );

          const offer = [getTestItem721(nftId)];

          const consideration = [
            getTestItem20(
              tokenAmount.sub(100),
              tokenAmount.sub(100),
              seller.address
            ),
            getTestItem20(50, 50, zone.address),
            getTestItem20(50, 50, owner.address),
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0, // FULL_OPEN
            [],
            null,
            seller,
            constants.HashZero,
            conduitKeyOne
          );

          const { mirrorOrder, mirrorOrderHash } =
            await createMirrorBuyNowOrder(buyer, zone, order);

          const fulfillments = defaultBuyNowMirrorFulfillment;

          const executions = await simulateMatchOrders(
            [order, mirrorOrder],
            fulfillments,
            owner,
            value
          );

          expect(executions.length).to.equal(4);

          const tx = await marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments);
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          await checkExpectedEvents(
            receipt,
            [
              {
                order: mirrorOrder,
                orderHash: mirrorOrderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          return receipt;
        });
      });
      describe("[Accept offer] User accepts a buy offer on a single ERC721", async () => {
        // Note: ETH is not a possible case
        it("ERC721 <=> ERC20 (standard)", async () => {
          // Buyer mints nft
          const nftId = ethers.BigNumber.from(randomHex());
          await testERC721.mint(buyer.address, nftId);

          // Buyer approves marketplace contract to transfer NFT
          await set721ApprovalForAll(buyer, marketplaceContract.address, true);

          // Seller mints ERC20
          const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);
          await mintAndApproveERC20(
            seller,
            marketplaceContract.address,
            tokenAmount
          );

          // Buyer approves marketplace contract to transfer ERC20 tokens too
          await expect(
            testERC20
              .connect(buyer)
              .approve(marketplaceContract.address, tokenAmount)
          )
            .to.emit(testERC20, "Approval")
            .withArgs(buyer.address, marketplaceContract.address, tokenAmount);

          const offer = [
            getTestItem20(tokenAmount.sub(100), tokenAmount.sub(100)),
          ];

          const consideration = [
            getTestItem721(nftId, 1, 1, seller.address),
            getTestItem20(50, 50, zone.address),
            getTestItem20(50, 50, owner.address),
          ];

          const { order, orderHash } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0 // FULL_OPEN
          );

          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, toKey(false));
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC721 <=> ERC20 (standard, via conduit)", async () => {
          // Buyer mints nft
          const nftId = ethers.BigNumber.from(randomHex());
          await testERC721.mint(buyer.address, nftId);

          // Buyer approves marketplace contract to transfer NFT
          await set721ApprovalForAll(buyer, marketplaceContract.address, true);

          // Seller mints ERC20
          const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);
          await mintAndApproveERC20(seller, conduitOne.address, tokenAmount);

          // Buyer approves marketplace contract to transfer ERC20 tokens
          await expect(
            testERC20
              .connect(buyer)
              .approve(marketplaceContract.address, tokenAmount)
          )
            .to.emit(testERC20, "Approval")
            .withArgs(buyer.address, marketplaceContract.address, tokenAmount);

          const offer = [
            getTestItem20(tokenAmount.sub(100), tokenAmount.sub(100)),
          ];

          const consideration = [
            getTestItem721(nftId, 1, 1, seller.address),
            getTestItem20(50, 50, zone.address),
            getTestItem20(50, 50, owner.address),
          ];

          const { order, orderHash } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0, // FULL_OPEN
            [],
            null,
            seller,
            constants.HashZero,
            conduitKeyOne
          );

          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, toKey(false));
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC721 <=> ERC20 (standard, fulfilled via conduit)", async () => {
          // Buyer mints nft
          const nftId = ethers.BigNumber.from(randomHex());
          await testERC721.mint(buyer.address, nftId);

          // Buyer approves conduit contract to transfer NFT
          await set721ApprovalForAll(buyer, conduitOne.address, true);

          // Seller mints ERC20
          const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);
          await mintAndApproveERC20(
            seller,
            marketplaceContract.address,
            tokenAmount
          );

          // Buyer approves conduit to transfer ERC20 tokens
          await expect(
            testERC20.connect(buyer).approve(conduitOne.address, tokenAmount)
          )
            .to.emit(testERC20, "Approval")
            .withArgs(buyer.address, conduitOne.address, tokenAmount);

          const offer = [
            getTestItem20(tokenAmount.sub(100), tokenAmount.sub(100)),
          ];

          const consideration = [
            getTestItem721(nftId, 1, 1, seller.address),
            getTestItem20(50, 50, zone.address),
            getTestItem20(50, 50, owner.address),
          ];

          const { order, orderHash } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0 // FULL_OPEN
          );

          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, conduitKeyOne);
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC721 <=> ERC20 (basic)", async () => {
          // Buyer mints nft
          const nftId = ethers.BigNumber.from(randomHex());
          await testERC721.mint(buyer.address, nftId);

          // Buyer approves marketplace contract to transfer NFT
          await set721ApprovalForAll(buyer, marketplaceContract.address, true);

          // Seller mints ERC20
          const tokenAmount = ethers.BigNumber.from(randomLarge());
          await mintAndApproveERC20(
            seller,
            marketplaceContract.address,
            tokenAmount
          );

          // NOTE: Buyer does not need to approve marketplace for ERC20 tokens

          const offer = [getTestItem20(tokenAmount, tokenAmount)];

          const consideration = [
            getTestItem721(nftId, 1, 1, seller.address),
            getTestItem20(50, 50, zone.address),
            getTestItem20(50, 50, owner.address),
          ];

          const { order, orderHash } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0 // FULL_OPEN
          );

          const basicOrderParameters = getBasicOrderParameters(
            4, // ERC721ForERC20
            order
          );

          await withBalanceChecks(
            [order],
            ethers.BigNumber.from(0),
            null,
            async () => {
              const tx = await marketplaceContract
                .connect(buyer)
                .fulfillBasicOrder(basicOrderParameters);
              const receipt = await tx.wait();
              await checkExpectedEvents(receipt, [
                {
                  order,
                  orderHash,
                  fulfiller: buyer.address,
                },
              ]);
              return receipt;
            }
          );
        });
        it("ERC721 <=> ERC20 (basic, many via conduit)", async () => {
          // Buyer mints nft
          const nftId = ethers.BigNumber.from(randomHex());
          await testERC721.mint(buyer.address, nftId);

          // Buyer approves marketplace contract to transfer NFT
          await set721ApprovalForAll(buyer, marketplaceContract.address, true);

          // Seller mints ERC20
          const tokenAmount = ethers.BigNumber.from(randomLarge());
          await mintAndApproveERC20(seller, conduitOne.address, tokenAmount);

          // NOTE: Buyer does not need to approve marketplace for ERC20 tokens

          const offer = [getTestItem20(tokenAmount, tokenAmount)];

          const consideration = [
            getTestItem721(nftId, 1, 1, seller.address),
            getTestItem20(1, 1, zone.address),
          ];

          for (let i = 1; i <= 50; ++i) {
            consideration.push(
              getTestItem20(i, i, toAddress(parseInt(i) + 10000))
            );
          }

          const { order, orderHash } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0, // FULL_OPEN
            [],
            null,
            seller,
            constants.HashZero,
            conduitKeyOne
          );

          const basicOrderParameters = getBasicOrderParameters(
            4, // ERC721ForERC20
            order
          );

          await withBalanceChecks(
            [order],
            ethers.BigNumber.from(0),
            null,
            async () => {
              const tx = await marketplaceContract
                .connect(buyer)
                .fulfillBasicOrder(basicOrderParameters);
              const receipt = await tx.wait();
              await checkExpectedEvents(receipt, [
                {
                  order,
                  orderHash,
                  fulfiller: buyer.address,
                },
              ]);
              return receipt;
            }
          );
        });
        it("ERC721 <=> ERC20 (basic, fulfilled via conduit)", async () => {
          // Buyer mints nft
          const nftId = ethers.BigNumber.from(randomHex());
          await testERC721.mint(buyer.address, nftId);

          // Buyer approves conduit contract to transfer NFT
          await set721ApprovalForAll(buyer, conduitOne.address, true);

          // Seller mints ERC20
          const tokenAmount = ethers.BigNumber.from(randomLarge());
          await mintAndApproveERC20(
            seller,
            marketplaceContract.address,
            tokenAmount
          );

          // NOTE: Buyer does not need to approve marketplace for ERC20 tokens

          const offer = [getTestItem20(tokenAmount, tokenAmount)];

          const consideration = [
            getTestItem721(nftId, 1, 1, seller.address),
            getTestItem20(50, 50, zone.address),
            getTestItem20(50, 50, owner.address),
          ];

          const { order, orderHash } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0 // FULL_OPEN
          );

          const basicOrderParameters = getBasicOrderParameters(
            4, // ERC721ForERC20
            order,
            conduitKeyOne
          );

          await withBalanceChecks(
            [order],
            ethers.BigNumber.from(0),
            null,
            async () => {
              const tx = await marketplaceContract
                .connect(buyer)
                .fulfillBasicOrder(basicOrderParameters);
              const receipt = await tx.wait();
              await checkExpectedEvents(receipt, [
                {
                  order,
                  orderHash,
                  fulfiller: buyer.address,
                },
              ]);
              return receipt;
            }
          );
        });
        it("ERC721 <=> ERC20 (match)", async () => {
          // Buyer mints nft
          const nftId = ethers.BigNumber.from(randomHex());
          await testERC721.mint(buyer.address, nftId);

          // Buyer approves marketplace contract to transfer NFT
          await set721ApprovalForAll(buyer, marketplaceContract.address, true);

          // Seller mints ERC20
          const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);
          await mintAndApproveERC20(
            seller,
            marketplaceContract.address,
            tokenAmount
          );

          // NOTE: Buyer does not need to approve marketplace for ERC20 tokens

          const offer = [
            getTestItem20(tokenAmount.sub(100), tokenAmount.sub(100)),
          ];

          const consideration = [
            getTestItem721(nftId, 1, 1, seller.address),
            getTestItem20(50, 50, zone.address),
            getTestItem20(50, 50, owner.address),
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0 // FULL_OPEN
          );

          const { mirrorOrder, mirrorOrderHash } =
            await createMirrorAcceptOfferOrder(buyer, zone, order);

          const fulfillments = defaultAcceptOfferMirrorFulfillment;

          const executions = await simulateMatchOrders(
            [order, mirrorOrder],
            fulfillments,
            owner,
            value
          );

          expect(executions.length).to.equal(4);

          const tx = await marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments);
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          await checkExpectedEvents(
            receipt,
            [
              {
                order: mirrorOrder,
                orderHash: mirrorOrderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          return receipt;
        });
        it("ERC721 <=> ERC20 (match via conduit)", async () => {
          // Buyer mints nft
          const nftId = ethers.BigNumber.from(randomHex());
          await testERC721.mint(buyer.address, nftId);

          // Buyer approves conduit contract to transfer NFT
          await set721ApprovalForAll(buyer, conduitOne.address, true);

          // Seller mints ERC20
          const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);
          await mintAndApproveERC20(
            seller,
            marketplaceContract.address,
            tokenAmount
          );

          // NOTE: Buyer does not need to approve marketplace for ERC20 tokens

          const offer = [
            getTestItem20(tokenAmount.sub(100), tokenAmount.sub(100)),
          ];

          const consideration = [
            getTestItem721(nftId, 1, 1, seller.address),
            getTestItem20(50, 50, zone.address),
            getTestItem20(50, 50, owner.address),
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0 // FULL_OPEN
          );

          const { mirrorOrder, mirrorOrderHash } =
            await createMirrorAcceptOfferOrder(
              buyer,
              zone,
              order,
              [],
              conduitKeyOne
            );

          const fulfillments = defaultAcceptOfferMirrorFulfillment;

          const executions = await simulateMatchOrders(
            [order, mirrorOrder],
            fulfillments,
            owner,
            value
          );

          expect(executions.length).to.equal(4);

          const tx = await marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments);
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          await checkExpectedEvents(
            receipt,
            [
              {
                order: mirrorOrder,
                orderHash: mirrorOrderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          return receipt;
        });
      });
    });

    describe("A single ERC1155 is to be transferred", async () => {
      describe("[Buy now] User fullfills a sell order for a single ERC1155", async () => {
        it("ERC1155 <=> ETH (standard)", async () => {
          // Seller mints nft
          const { nftId, amount } = await mintAndApprove1155(
            seller,
            marketplaceContract.address
          );

          const offer = [getTestItem1155(nftId, amount, amount)];

          const consideration = [
            getItemETH(10, 10, seller.address),
            getItemETH(1, 1, zone.address),
            getItemETH(1, 1, owner.address),
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0 // FULL_OPEN
          );

          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, toKey(false), {
                value,
              });
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC1155 <=> ETH (standard via conduit)", async () => {
          // Seller mints nft
          const { nftId, amount } = await mintAndApprove1155(
            seller,
            conduitOne.address
          );

          const offer = [getTestItem1155(nftId, amount, amount)];

          const consideration = [
            getItemETH(10, 10, seller.address),
            getItemETH(1, 1, zone.address),
            getItemETH(1, 1, owner.address),
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0, // FULL_OPEN
            [],
            null,
            seller,
            constants.HashZero,
            conduitKeyOne
          );

          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, toKey(false), {
                value,
              });
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC1155 <=> ETH (basic)", async () => {
          // Seller mints nft
          const { nftId, amount } = await mintAndApprove1155(
            seller,
            marketplaceContract.address
          );

          const offer = [getTestItem1155(nftId, amount, amount)];

          const consideration = [
            getItemETH(10, 10, seller.address),
            getItemETH(1, 1, zone.address),
            getItemETH(1, 1, owner.address),
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0 // FULL_OPEN
          );

          const basicOrderParameters = getBasicOrderParameters(
            1, // EthForERC1155
            order
          );

          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillBasicOrder(basicOrderParameters, {
                value,
              });
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC1155 <=> ETH (basic via conduit)", async () => {
          // Seller mints nft
          const { nftId, amount } = await mintAndApprove1155(
            seller,
            conduitOne.address
          );

          const offer = [getTestItem1155(nftId, amount, amount)];

          const consideration = [
            getItemETH(10, 10, seller.address),
            getItemETH(1, 1, zone.address),
            getItemETH(1, 1, owner.address),
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0, // FULL_OPEN
            [],
            null,
            seller,
            constants.HashZero,
            conduitKeyOne
          );

          const basicOrderParameters = getBasicOrderParameters(
            1, // EthForERC1155
            order
          );

          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillBasicOrder(basicOrderParameters, {
                value,
              });
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC1155 <=> ETH (match)", async () => {
          // Seller mints nft
          const { nftId, amount } = await mintAndApprove1155(
            seller,
            marketplaceContract.address
          );

          const offer = [getTestItem1155(nftId, amount, amount)];

          const consideration = [
            getItemETH(10, 10, seller.address),
            getItemETH(1, 1, zone.address),
            getItemETH(1, 1, owner.address),
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0 // FULL_OPEN
          );

          const { mirrorOrder, mirrorOrderHash } =
            await createMirrorBuyNowOrder(buyer, zone, order);

          const fulfillments = defaultBuyNowMirrorFulfillment;

          const executions = await simulateMatchOrders(
            [order, mirrorOrder],
            fulfillments,
            owner,
            value
          );

          expect(executions.length).to.equal(4);

          const tx = await marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments, {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          await checkExpectedEvents(
            receipt,
            [
              {
                order: mirrorOrder,
                orderHash: mirrorOrderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          return receipt;
        });
        it("ERC1155 <=> ETH (match via conduit)", async () => {
          // Seller mints nft
          const { nftId, amount } = await mintAndApprove1155(
            seller,
            conduitOne.address
          );

          const offer = [getTestItem1155(nftId, amount, amount)];

          const consideration = [
            getItemETH(10, 10, seller.address),
            getItemETH(1, 1, zone.address),
            getItemETH(1, 1, owner.address),
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0, // FULL_OPEN
            [],
            null,
            seller,
            constants.HashZero,
            conduitKeyOne
          );

          const { mirrorOrder, mirrorOrderHash } =
            await createMirrorBuyNowOrder(buyer, zone, order);

          const fulfillments = defaultBuyNowMirrorFulfillment;

          const executions = await simulateMatchOrders(
            [order, mirrorOrder],
            fulfillments,
            owner,
            value
          );

          expect(executions.length).to.equal(4);

          const tx = await marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments, {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          await checkExpectedEvents(
            receipt,
            [
              {
                order: mirrorOrder,
                orderHash: mirrorOrderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          return receipt;
        });
        it("ERC1155 <=> ERC20 (standard)", async () => {
          // Seller mints nft
          const { nftId, amount } = await mintAndApprove1155(
            seller,
            marketplaceContract.address
          );

          // Buyer mints ERC20
          const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);
          await mintAndApproveERC20(
            buyer,
            marketplaceContract.address,
            tokenAmount
          );

          const offer = [getTestItem1155(nftId, amount, amount)];

          const consideration = [
            getTestItem20(
              tokenAmount.sub(100),
              tokenAmount.sub(100),
              seller.address
            ),
            getTestItem20(50, 50, zone.address),
            getTestItem20(50, 50, owner.address),
          ];

          const { order, orderHash } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0 // FULL_OPEN
          );

          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, toKey(false));
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC1155 <=> ERC20 (standard via conduit)", async () => {
          // Seller mints nft
          const { nftId, amount } = await mintAndApprove1155(
            seller,
            conduitOne.address
          );

          // Buyer mints ERC20
          const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);
          await mintAndApproveERC20(
            buyer,
            marketplaceContract.address,
            tokenAmount
          );

          const offer = [getTestItem1155(nftId, amount, amount)];

          const consideration = [
            getTestItem20(
              tokenAmount.sub(100),
              tokenAmount.sub(100),
              seller.address
            ),
            getTestItem20(50, 50, zone.address),
            getTestItem20(50, 50, owner.address),
          ];

          const { order, orderHash } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0, // FULL_OPEN
            [],
            null,
            seller,
            constants.HashZero,
            conduitKeyOne
          );

          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, toKey(false));
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC1155 <=> ERC20 (basic)", async () => {
          // Seller mints nft
          const { nftId, amount } = await mintAndApprove1155(
            seller,
            marketplaceContract.address
          );

          // Buyer mints ERC20
          const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);
          await mintAndApproveERC20(
            buyer,
            marketplaceContract.address,
            tokenAmount
          );

          const offer = [getTestItem1155(nftId, amount, amount)];

          const consideration = [
            getTestItem20(
              tokenAmount.sub(100),
              tokenAmount.sub(100),
              seller.address
            ),
            getTestItem20(50, 50, zone.address),
            getTestItem20(50, 50, owner.address),
          ];

          const { order, orderHash } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0 // FULL_OPEN
          );

          const basicOrderParameters = getBasicOrderParameters(
            3, // ERC20ForERC1155
            order
          );

          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillBasicOrder(basicOrderParameters);
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC1155 <=> ERC20 (basic via conduit)", async () => {
          // Seller mints nft
          const { nftId, amount } = await mintAndApprove1155(
            seller,
            conduitOne.address
          );

          // Buyer mints ERC20
          const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);
          await mintAndApproveERC20(
            buyer,
            marketplaceContract.address,
            tokenAmount
          );

          const offer = [getTestItem1155(nftId, amount, amount)];

          const consideration = [
            getTestItem20(
              tokenAmount.sub(100),
              tokenAmount.sub(100),
              seller.address
            ),
            getTestItem20(50, 50, zone.address),
            getTestItem20(50, 50, owner.address),
          ];

          const { order, orderHash } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0, // FULL_OPEN
            [],
            null,
            seller,
            constants.HashZero,
            conduitKeyOne
          );

          const basicOrderParameters = getBasicOrderParameters(
            3, // ERC20ForERC1155
            order
          );

          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillBasicOrder(basicOrderParameters);
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC1155 <=> ERC20 (match)", async () => {
          // Seller mints nft
          const { nftId, amount } = await mintAndApprove1155(
            seller,
            marketplaceContract.address
          );

          // Buyer mints ERC20
          const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);
          await mintAndApproveERC20(
            buyer,
            marketplaceContract.address,
            tokenAmount
          );

          const offer = [getTestItem1155(nftId, amount, amount)];

          const consideration = [
            getTestItem20(
              tokenAmount.sub(100),
              tokenAmount.sub(100),
              seller.address
            ),
            getTestItem20(50, 50, zone.address),
            getTestItem20(50, 50, owner.address),
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0 // FULL_OPEN
          );

          const { mirrorOrder, mirrorOrderHash } =
            await createMirrorBuyNowOrder(buyer, zone, order);

          const fulfillments = defaultBuyNowMirrorFulfillment;

          const executions = await simulateMatchOrders(
            [order, mirrorOrder],
            fulfillments,
            owner,
            value
          );

          expect(executions.length).to.equal(4);

          const tx = await marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments);
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          await checkExpectedEvents(
            receipt,
            [
              {
                order: mirrorOrder,
                orderHash: mirrorOrderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          return receipt;
        });
        it("ERC1155 <=> ERC20 (match via conduit)", async () => {
          // Seller mints nft
          const { nftId, amount } = await mintAndApprove1155(
            seller,
            conduitOne.address
          );

          // Buyer mints ERC20
          const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);
          await mintAndApproveERC20(
            buyer,
            marketplaceContract.address,
            tokenAmount
          );

          const offer = [getTestItem1155(nftId, amount, amount)];

          const consideration = [
            getTestItem20(
              tokenAmount.sub(100),
              tokenAmount.sub(100),
              seller.address
            ),
            getTestItem20(50, 50, zone.address),
            getTestItem20(50, 50, owner.address),
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0, // FULL_OPEN
            [],
            null,
            seller,
            constants.HashZero,
            conduitKeyOne
          );

          const { mirrorOrder, mirrorOrderHash } =
            await createMirrorBuyNowOrder(buyer, zone, order);

          const fulfillments = defaultBuyNowMirrorFulfillment;

          const executions = await simulateMatchOrders(
            [order, mirrorOrder],
            fulfillments,
            owner,
            value
          );

          expect(executions.length).to.equal(4);

          const tx = await marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments);
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          await checkExpectedEvents(
            receipt,
            [
              {
                order: mirrorOrder,
                orderHash: mirrorOrderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          return receipt;
        });
      });
      describe("[Accept offer] User accepts a buy offer on a single ERC1155", async () => {
        // Note: ETH is not a possible case
        it("ERC1155 <=> ERC20 (standard)", async () => {
          // Buyer mints nft
          const { nftId, amount } = await mintAndApprove1155(
            buyer,
            marketplaceContract.address
          );

          // Seller mints ERC20
          const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);
          await mintAndApproveERC20(
            seller,
            marketplaceContract.address,
            tokenAmount
          );

          // Buyer approves marketplace contract to transfer ERC20 tokens too
          await expect(
            testERC20
              .connect(buyer)
              .approve(marketplaceContract.address, tokenAmount)
          )
            .to.emit(testERC20, "Approval")
            .withArgs(buyer.address, marketplaceContract.address, tokenAmount);

          const offer = [
            getTestItem20(tokenAmount.sub(100), tokenAmount.sub(100)),
          ];

          const consideration = [
            getTestItem1155(nftId, amount, amount, undefined, seller.address),
            getTestItem20(50, 50, zone.address),
            getTestItem20(50, 50, owner.address),
          ];

          const { order, orderHash } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0 // FULL_OPEN
          );

          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, toKey(false));
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC1155 <=> ERC20 (standard, fulfilled via conduit)", async () => {
          // Buyer mints nft
          const nftId = ethers.BigNumber.from(randomHex());
          const amount = ethers.BigNumber.from(randomHex());
          await testERC1155.mint(buyer.address, nftId, amount);

          // Buyer approves conduit contract to transfer NFT
          await set1155ApprovalForAll(buyer, conduitOne.address, true);

          // Seller mints ERC20
          const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);
          await mintAndApproveERC20(
            seller,
            marketplaceContract.address,
            tokenAmount
          );

          // Buyer approves conduit to transfer ERC20 tokens
          await expect(
            testERC20.connect(buyer).approve(conduitOne.address, tokenAmount)
          )
            .to.emit(testERC20, "Approval")
            .withArgs(buyer.address, conduitOne.address, tokenAmount);

          const offer = [
            getTestItem20(tokenAmount.sub(100), tokenAmount.sub(100)),
          ];

          const consideration = [
            getTestItem1155(nftId, amount, amount, undefined, seller.address),
            getTestItem20(50, 50, zone.address),
            getTestItem20(50, 50, owner.address),
          ];

          const { order, orderHash } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0 // FULL_OPEN
          );

          await withBalanceChecks([order], 0, null, async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, conduitKeyOne);
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          });
        });
        it("ERC1155 <=> ERC20 (basic)", async () => {
          // Buyer mints nft
          const { nftId, amount } = await mintAndApprove1155(
            buyer,
            marketplaceContract.address
          );

          // Seller mints ERC20
          const tokenAmount = ethers.BigNumber.from(randomLarge());
          await mintAndApproveERC20(
            seller,
            marketplaceContract.address,
            tokenAmount
          );

          // NOTE: Buyer does not need to approve marketplace for ERC20 tokens

          const offer = [getTestItem20(tokenAmount, tokenAmount)];

          const consideration = [
            getTestItem1155(nftId, amount, amount, undefined, seller.address),
            getTestItem20(50, 50, zone.address),
            getTestItem20(50, 50, owner.address),
          ];

          const { order, orderHash } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0 // FULL_OPEN
          );

          const basicOrderParameters = getBasicOrderParameters(
            5, // ERC1155ForERC20
            order
          );

          await withBalanceChecks(
            [order],
            ethers.BigNumber.from(0),
            null,
            async () => {
              const tx = await marketplaceContract
                .connect(buyer)
                .fulfillBasicOrder(basicOrderParameters);
              const receipt = await tx.wait();
              await checkExpectedEvents(receipt, [
                {
                  order,
                  orderHash,
                  fulfiller: buyer.address,
                },
              ]);
              return receipt;
            }
          );
        });
        it("ERC1155 <=> ERC20 (basic, fulfilled via conduit)", async () => {
          // Buyer mints nft
          const nftId = ethers.BigNumber.from(randomHex());
          const amount = ethers.BigNumber.from(randomHex());
          await testERC1155.mint(buyer.address, nftId, amount);

          // Buyer approves conduit contract to transfer NFT
          await set1155ApprovalForAll(buyer, conduitOne.address, true);

          // Seller mints ERC20
          const tokenAmount = ethers.BigNumber.from(randomLarge());
          await mintAndApproveERC20(
            seller,
            marketplaceContract.address,
            tokenAmount
          );

          // NOTE: Buyer does not need to approve marketplace for ERC20 tokens

          const offer = [getTestItem20(tokenAmount, tokenAmount)];

          const consideration = [
            getTestItem1155(nftId, amount, amount, undefined, seller.address),
            getTestItem20(50, 50, zone.address),
            getTestItem20(50, 50, owner.address),
          ];

          const { order, orderHash } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0 // FULL_OPEN
          );

          const basicOrderParameters = getBasicOrderParameters(
            5, // ERC1155ForERC20
            order,
            conduitKeyOne
          );

          await withBalanceChecks(
            [order],
            ethers.BigNumber.from(0),
            null,
            async () => {
              const tx = await marketplaceContract
                .connect(buyer)
                .fulfillBasicOrder(basicOrderParameters);
              const receipt = await tx.wait();
              await checkExpectedEvents(receipt, [
                {
                  order,
                  orderHash,
                  fulfiller: buyer.address,
                },
              ]);
              return receipt;
            }
          );
        });
        it("ERC1155 <=> ERC20 (match)", async () => {
          // Buyer mints nft
          const { nftId, amount } = await mintAndApprove1155(
            buyer,
            marketplaceContract.address
          );

          // Seller mints ERC20
          const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);
          await mintAndApproveERC20(
            seller,
            marketplaceContract.address,
            tokenAmount
          );

          // NOTE: Buyer does not need to approve marketplace for ERC20 tokens

          const offer = [
            getTestItem20(tokenAmount.sub(100), tokenAmount.sub(100)),
          ];

          const consideration = [
            getTestItem1155(nftId, amount, amount, undefined, seller.address),
            getTestItem20(50, 50, zone.address),
            getTestItem20(50, 50, owner.address),
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0 // FULL_OPEN
          );

          const { mirrorOrder, mirrorOrderHash } =
            await createMirrorAcceptOfferOrder(buyer, zone, order);

          const fulfillments = defaultAcceptOfferMirrorFulfillment;

          const executions = await simulateMatchOrders(
            [order, mirrorOrder],
            fulfillments,
            owner,
            value
          );

          expect(executions.length).to.equal(4);

          const tx = await marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments);
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          await checkExpectedEvents(
            receipt,
            [
              {
                order: mirrorOrder,
                orderHash: mirrorOrderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          return receipt;
        });
        it("ERC1155 <=> ERC20 (match via conduit)", async () => {
          // Buyer mints nft
          const nftId = ethers.BigNumber.from(randomHex());
          const amount = ethers.BigNumber.from(randomHex());
          await testERC1155.mint(buyer.address, nftId, amount);

          // Buyer approves conduit contract to transfer NFT
          await set1155ApprovalForAll(buyer, conduitOne.address, true);

          // Seller mints ERC20
          const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);
          await mintAndApproveERC20(
            seller,
            marketplaceContract.address,
            tokenAmount
          );

          // NOTE: Buyer does not need to approve marketplace for ERC20 tokens

          const offer = [
            getTestItem20(tokenAmount.sub(100), tokenAmount.sub(100)),
          ];

          const consideration = [
            getTestItem1155(nftId, amount, amount, undefined, seller.address),
            getTestItem20(50, 50, zone.address),
            getTestItem20(50, 50, owner.address),
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0 // FULL_OPEN
          );

          const { mirrorOrder, mirrorOrderHash } =
            await createMirrorAcceptOfferOrder(
              buyer,
              zone,
              order,
              [],
              conduitKeyOne
            );

          const fulfillments = defaultAcceptOfferMirrorFulfillment;

          const executions = await simulateMatchOrders(
            [order, mirrorOrder],
            fulfillments,
            owner,
            value
          );

          expect(executions.length).to.equal(4);

          const tx = await marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments);
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          await checkExpectedEvents(
            receipt,
            [
              {
                order: mirrorOrder,
                orderHash: mirrorOrderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          return receipt;
        });
      });
    });
  });

  describe("Validate, cancel, and increment nonce flows", async () => {
    let seller;
    let buyer;

    beforeEach(async () => {
      // Setup basic buyer/seller wallets with ETH
      seller = ethers.Wallet.createRandom().connect(provider);
      buyer = ethers.Wallet.createRandom().connect(provider);
      zone = ethers.Wallet.createRandom().connect(provider);
      await Promise.all(
        [seller, buyer, zone].map((wallet) => faucet(wallet.address, provider))
      );
    });

    describe("Validate", async () => {
      it("Validate signed order and fill it with no signature", async () => {
        // Seller mints an nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const signature = order.signature;

        const initialStatus = await marketplaceContract.getOrderStatus(
          orderHash
        );
        expect(initialStatus.isValidated).to.be.false;
        expect(initialStatus.isCancelled).to.be.false;

        // cannot fill it with no signature yet
        order.signature = "0x";

        if (!process.env.REFERENCE) {
          await expect(
            marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, toKey(false), {
                value,
              })
          ).to.be.revertedWith("InvalidSigner");

          // cannot validate it with no signature from a random account
          await expect(
            marketplaceContract.connect(owner).validate([order])
          ).to.be.revertedWith("InvalidSigner");
        } else {
          await expect(
            marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, toKey(false), {
                value,
              })
          ).to.be.reverted;

          // cannot validate it with no signature from a random account
          await expect(marketplaceContract.connect(owner).validate([order])).to
            .be.reverted;
        }

        // can validate it once you add the signature back
        order.signature = signature;
        await expect(marketplaceContract.connect(owner).validate([order]))
          .to.emit(marketplaceContract, "OrderValidated")
          .withArgs(orderHash, seller.address, zone.address);

        const newStatus = await marketplaceContract.getOrderStatus(orderHash);
        expect(newStatus.isValidated).to.be.true;
        expect(newStatus.isCancelled).to.be.false;
        expect(newStatus.totalFilled.toString()).to.equal("0");
        expect(newStatus.totalSize.toString()).to.equal("0");

        // Can validate it repeatedly, but no event after the first time
        await marketplaceContract.connect(owner).validate([order, order]);

        // Fulfill the order without a signature
        order.signature = "0x";
        await withBalanceChecks([order], 0, null, async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillOrder(order, toKey(false), {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(receipt, [
            {
              order,
              orderHash,
              fulfiller: buyer.address,
            },
          ]);
          return receipt;
        });

        const finalStatus = await marketplaceContract.getOrderStatus(orderHash);
        expect(finalStatus.isValidated).to.be.true;
        expect(finalStatus.isCancelled).to.be.false;
        expect(finalStatus.totalFilled.toString()).to.equal("1");
        expect(finalStatus.totalSize.toString()).to.equal("1");

        // cannot validate it once it's been fully filled
        await expect(
          marketplaceContract.connect(owner).validate([order])
        ).to.be.revertedWith("OrderAlreadyFilled", orderHash);
      });
      it("Validate unsigned order from offerer and fill it with no signature", async () => {
        // Seller mints an nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        order.signature = "0x";

        const initialStatus = await marketplaceContract.getOrderStatus(
          orderHash
        );
        expect(initialStatus.isValidated).to.be.false;
        expect(initialStatus.isCancelled).to.be.false;

        if (!process.env.REFERENCE) {
          // cannot fill it with no signature yet
          await expect(
            marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, toKey(false), {
                value,
              })
          ).to.be.revertedWith("InvalidSigner");

          // cannot validate it with no signature from a random account
          await expect(
            marketplaceContract.connect(owner).validate([order])
          ).to.be.revertedWith("InvalidSigner");
        } else {
          // cannot fill it with no signature yet
          await expect(
            marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, toKey(false), {
                value,
              })
          ).to.be.reverted;

          // cannot validate it with no signature from a random account
          await expect(marketplaceContract.connect(owner).validate([order])).to
            .be.reverted;
        }

        // can validate it from the seller
        await expect(marketplaceContract.connect(seller).validate([order]))
          .to.emit(marketplaceContract, "OrderValidated")
          .withArgs(orderHash, seller.address, zone.address);

        const newStatus = await marketplaceContract.getOrderStatus(orderHash);
        expect(newStatus.isValidated).to.be.true;
        expect(newStatus.isCancelled).to.be.false;
        expect(newStatus.totalFilled.toString()).to.equal("0");
        expect(newStatus.totalSize.toString()).to.equal("0");

        // Fulfill the order without a signature
        order.signature = "0x";
        await withBalanceChecks([order], 0, null, async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillOrder(order, toKey(false), {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(receipt, [
            {
              order,
              orderHash,
              fulfiller: buyer.address,
            },
          ]);
          return receipt;
        });

        const finalStatus = await marketplaceContract.getOrderStatus(orderHash);
        expect(finalStatus.isValidated).to.be.true;
        expect(finalStatus.isCancelled).to.be.false;
        expect(finalStatus.totalFilled.toString()).to.equal("1");
        expect(finalStatus.totalSize.toString()).to.equal("1");
      });
      it("Cannot validate a cancelled order", async () => {
        // Seller mints an nft
        const nftId = ethers.BigNumber.from(randomHex());

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, orderHash, value, orderComponents } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const signature = order.signature;

        order.signature = "0x";

        const initialStatus = await marketplaceContract.getOrderStatus(
          orderHash
        );
        expect(initialStatus.isValidated).to.be.false;
        expect(initialStatus.isCancelled).to.be.false;

        if (!process.env.REFERENCE) {
          // cannot fill it with no signature yet
          await expect(
            marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, toKey(false), {
                value,
              })
          ).to.be.revertedWith("InvalidSigner");

          // cannot validate it with no signature from a random account
          await expect(
            marketplaceContract.connect(owner).validate([order])
          ).to.be.revertedWith("InvalidSigner");
        } else {
          // cannot fill it with no signature yet
          await expect(
            marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, toKey(false), {
                value,
              })
          ).to.be.reverted;

          // cannot validate it with no signature from a random account
          await expect(marketplaceContract.connect(owner).validate([order])).to
            .be.reverted;
        }

        // can cancel it
        await expect(
          marketplaceContract.connect(seller).cancel([orderComponents])
        )
          .to.emit(marketplaceContract, "OrderCancelled")
          .withArgs(orderHash, seller.address, zone.address);

        // cannot validate it from the seller
        await expect(
          marketplaceContract.connect(seller).validate([order])
        ).to.be.revertedWith(`OrderIsCancelled("${orderHash}")`);

        // cannot validate it with a signature either
        order.signature = signature;
        await expect(
          marketplaceContract.connect(owner).validate([order])
        ).to.be.revertedWith(`OrderIsCancelled("${orderHash}")`);

        const newStatus = await marketplaceContract.getOrderStatus(orderHash);
        expect(newStatus.isValidated).to.be.false;
        expect(newStatus.isCancelled).to.be.true;
        expect(newStatus.totalFilled.toString()).to.equal("0");
        expect(newStatus.totalSize.toString()).to.equal("0");
      });
    });

    describe("Cancel", async () => {
      it("Can cancel an order", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, orderHash, value, orderComponents } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        // cannot cancel it from a random account
        await expect(
          marketplaceContract.connect(owner).cancel([orderComponents])
        ).to.be.revertedWith("InvalidCanceller");

        const initialStatus = await marketplaceContract.getOrderStatus(
          orderHash
        );
        expect(initialStatus.isValidated).to.be.false;
        expect(initialStatus.isCancelled).to.be.false;
        expect(initialStatus.totalFilled.toString()).to.equal("0");
        expect(initialStatus.totalSize.toString()).to.equal("0");

        // can cancel it
        await expect(
          marketplaceContract.connect(seller).cancel([orderComponents])
        )
          .to.emit(marketplaceContract, "OrderCancelled")
          .withArgs(orderHash, seller.address, zone.address);

        // cannot fill the order anymore
        await expect(
          marketplaceContract.connect(buyer).fulfillOrder(order, toKey(false), {
            value,
          })
        ).to.be.revertedWith(`OrderIsCancelled("${orderHash}")`);

        const newStatus = await marketplaceContract.getOrderStatus(orderHash);
        expect(newStatus.isValidated).to.be.false;
        expect(newStatus.isCancelled).to.be.true;
        expect(newStatus.totalFilled.toString()).to.equal("0");
        expect(newStatus.totalSize.toString()).to.equal("0");
      });
      it("Can cancel a validated order", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, orderHash, value, orderComponents } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        // cannot cancel it from a random account
        await expect(
          marketplaceContract.connect(owner).cancel([orderComponents])
        ).to.be.revertedWith("InvalidCanceller");

        const initialStatus = await marketplaceContract.getOrderStatus(
          orderHash
        );
        expect(initialStatus.isValidated).to.be.false;
        expect(initialStatus.isCancelled).to.be.false;
        expect(initialStatus.totalFilled.toString()).to.equal("0");
        expect(initialStatus.totalSize.toString()).to.equal("0");

        // Can validate it
        await expect(marketplaceContract.connect(owner).validate([order]))
          .to.emit(marketplaceContract, "OrderValidated")
          .withArgs(orderHash, seller.address, zone.address);

        const newStatus = await marketplaceContract.getOrderStatus(orderHash);
        expect(newStatus.isValidated).to.be.true;
        expect(newStatus.isCancelled).to.be.false;
        expect(newStatus.totalFilled.toString()).to.equal("0");
        expect(newStatus.totalSize.toString()).to.equal("0");

        // can cancel it
        await expect(
          marketplaceContract.connect(seller).cancel([orderComponents])
        )
          .to.emit(marketplaceContract, "OrderCancelled")
          .withArgs(orderHash, seller.address, zone.address);

        // cannot fill the order anymore
        await expect(
          marketplaceContract.connect(buyer).fulfillOrder(order, toKey(false), {
            value,
          })
        ).to.be.revertedWith(`OrderIsCancelled("${orderHash}")`);

        const finalStatus = await marketplaceContract.getOrderStatus(orderHash);
        expect(finalStatus.isValidated).to.be.false;
        expect(finalStatus.isCancelled).to.be.true;
        expect(finalStatus.totalFilled.toString()).to.equal("0");
        expect(finalStatus.totalSize.toString()).to.equal("0");
      });
      it("Can cancel an order from the zone", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, orderHash, value, orderComponents } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        // cannot cancel it from a random account
        await expect(
          marketplaceContract.connect(owner).cancel([orderComponents])
        ).to.be.revertedWith("InvalidCanceller");

        const initialStatus = await marketplaceContract.getOrderStatus(
          orderHash
        );
        expect(initialStatus.isValidated).to.be.false;
        expect(initialStatus.isCancelled).to.be.false;
        expect(initialStatus.totalFilled.toString()).to.equal("0");
        expect(initialStatus.totalSize.toString()).to.equal("0");

        // can cancel it from the zone
        await expect(
          marketplaceContract.connect(zone).cancel([orderComponents])
        )
          .to.emit(marketplaceContract, "OrderCancelled")
          .withArgs(orderHash, seller.address, zone.address);

        // cannot fill the order anymore
        await expect(
          marketplaceContract.connect(buyer).fulfillOrder(order, toKey(false), {
            value,
          })
        ).to.be.revertedWith(`OrderIsCancelled("${orderHash}")`);

        const newStatus = await marketplaceContract.getOrderStatus(orderHash);
        expect(newStatus.isValidated).to.be.false;
        expect(newStatus.isCancelled).to.be.true;
        expect(newStatus.totalFilled.toString()).to.equal("0");
        expect(newStatus.totalSize.toString()).to.equal("0");
      });
      it("Can cancel a validated order from a zone", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, orderHash, value, orderComponents } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const initialStatus = await marketplaceContract.getOrderStatus(
          orderHash
        );
        expect(initialStatus.isValidated).to.be.false;
        expect(initialStatus.isCancelled).to.be.false;
        expect(initialStatus.totalFilled.toString()).to.equal("0");
        expect(initialStatus.totalSize.toString()).to.equal("0");

        // Can validate it
        await expect(marketplaceContract.connect(owner).validate([order]))
          .to.emit(marketplaceContract, "OrderValidated")
          .withArgs(orderHash, seller.address, zone.address);

        // cannot cancel it from a random account
        await expect(
          marketplaceContract.connect(owner).cancel([orderComponents])
        ).to.be.revertedWith("InvalidCanceller");

        const newStatus = await marketplaceContract.getOrderStatus(orderHash);
        expect(newStatus.isValidated).to.be.true;
        expect(newStatus.isCancelled).to.be.false;
        expect(newStatus.totalFilled.toString()).to.equal("0");
        expect(newStatus.totalSize.toString()).to.equal("0");

        // can cancel it from the zone
        await expect(
          marketplaceContract.connect(zone).cancel([orderComponents])
        )
          .to.emit(marketplaceContract, "OrderCancelled")
          .withArgs(orderHash, seller.address, zone.address);

        // cannot fill the order anymore
        await expect(
          marketplaceContract.connect(buyer).fulfillOrder(order, toKey(false), {
            value,
          })
        ).to.be.revertedWith(`OrderIsCancelled("${orderHash}")`);

        const finalStatus = await marketplaceContract.getOrderStatus(orderHash);
        expect(finalStatus.isValidated).to.be.false;
        expect(finalStatus.isCancelled).to.be.true;
        expect(finalStatus.totalFilled.toString()).to.equal("0");
        expect(finalStatus.totalSize.toString()).to.equal("0");
      });
      it.skip("Can cancel an order signed with a nonce ahead of the current nonce", async () => {});
    });

    describe("Increment Nonce", async () => {
      it("Can increment the nonce", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        let { order, orderHash, value, orderComponents } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const nonce = await marketplaceContract.getNonce(seller.address);
        expect(nonce).to.equal(0);
        expect(orderComponents.nonce).to.equal(nonce);

        // can increment the nonce
        await expect(marketplaceContract.connect(seller).incrementNonce())
          .to.emit(marketplaceContract, "NonceIncremented")
          .withArgs(1, seller.address);

        const newNonce = await marketplaceContract.getNonce(seller.address);
        expect(newNonce).to.equal(1);

        if (!process.env.REFERENCE) {
          // Cannot fill order anymore
          await expect(
            marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, toKey(false), {
                value,
              })
          ).to.be.revertedWith("InvalidSigner");
        } else {
          // Cannot fill order anymore
          await expect(
            marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, toKey(false), {
                value,
              })
          ).to.be.reverted;
        }

        const newOrderDetails = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        order = newOrderDetails.order;
        orderHash = newOrderDetails.orderHash;
        value = newOrderDetails.value;
        orderComponents = newOrderDetails.orderComponents;

        expect(orderComponents.nonce).to.equal(newNonce);

        // Can fill order with new nonce
        await withBalanceChecks([order], 0, null, async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillOrder(order, toKey(false), {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(receipt, [
            {
              order,
              orderHash,
              fulfiller: buyer.address,
            },
          ]);
          return receipt;
        });
      });
      it("Can increment the nonce and implicitly cancel a validated order", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        let { order, orderHash, value, orderComponents } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const nonce = await marketplaceContract.getNonce(seller.address);
        expect(nonce).to.equal(0);
        expect(orderComponents.nonce).to.equal(nonce);

        await expect(marketplaceContract.connect(owner).validate([order]))
          .to.emit(marketplaceContract, "OrderValidated")
          .withArgs(orderHash, seller.address, zone.address);

        // can increment the nonce
        await expect(marketplaceContract.connect(seller).incrementNonce())
          .to.emit(marketplaceContract, "NonceIncremented")
          .withArgs(1, seller.address);

        const newNonce = await marketplaceContract.getNonce(seller.address);
        expect(newNonce).to.equal(1);

        if (!process.env.REFERENCE) {
          // Cannot fill order anymore
          await expect(
            marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, toKey(false), {
                value,
              })
          ).to.be.revertedWith("InvalidSigner");
        } else {
          // Cannot fill order anymore
          await expect(
            marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, toKey(false), {
                value,
              })
          ).to.be.reverted;
        }

        const newOrderDetails = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        order = newOrderDetails.order;
        orderHash = newOrderDetails.orderHash;
        value = newOrderDetails.value;
        orderComponents = newOrderDetails.orderComponents;

        expect(orderComponents.nonce).to.equal(newNonce);

        // Can fill order with new nonce
        await withBalanceChecks([order], 0, null, async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillOrder(order, toKey(false), {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(receipt, [
            {
              order,
              orderHash,
              fulfiller: buyer.address,
            },
          ]);
          return receipt;
        });
      });
      it("Can increment the nonce as the zone and implicitly cancel a validated order", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        let { order, orderHash, value, orderComponents } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const nonce = await marketplaceContract.getNonce(seller.address);
        expect(nonce).to.equal(0);
        expect(orderComponents.nonce).to.equal(nonce);

        await expect(marketplaceContract.connect(owner).validate([order]))
          .to.emit(marketplaceContract, "OrderValidated")
          .withArgs(orderHash, seller.address, zone.address);

        // can increment the nonce as the offerer
        await expect(marketplaceContract.connect(seller).incrementNonce())
          .to.emit(marketplaceContract, "NonceIncremented")
          .withArgs(1, seller.address);

        const newNonce = await marketplaceContract.getNonce(seller.address);
        expect(newNonce).to.equal(1);

        if (!process.env.REFERENCE) {
          // Cannot fill order anymore
          await expect(
            marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, toKey(false), {
                value,
              })
          ).to.be.revertedWith("InvalidSigner");
        } else {
          // Cannot fill order anymore
          await expect(
            marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, toKey(false), {
                value,
              })
          ).to.be.reverted;
        }

        const newOrderDetails = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        order = newOrderDetails.order;
        orderHash = newOrderDetails.orderHash;
        value = newOrderDetails.value;
        orderComponents = newOrderDetails.orderComponents;

        expect(orderComponents.nonce).to.equal(newNonce);

        // Can fill order with new nonce
        await withBalanceChecks([order], 0, null, async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillOrder(order, toKey(false), {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(receipt, [
            {
              order,
              orderHash,
              fulfiller: buyer.address,
            },
          ]);
          return receipt;
        });
      });
      it.skip("Can increment nonce and activate an order signed with a nonce ahead of the current nonce", async () => {});
    });
  });

  describe("Advanced orders", async () => {
    let seller;
    let buyer;

    beforeEach(async () => {
      // Setup basic buyer/seller wallets with ETH
      seller = ethers.Wallet.createRandom().connect(provider);
      buyer = ethers.Wallet.createRandom().connect(provider);
      zone = ethers.Wallet.createRandom().connect(provider);
      await Promise.all(
        [seller, buyer, zone].map((wallet) => faucet(wallet.address, provider))
      );
    });

    describe("Partial fills", async () => {
      it("Partial fills (standard)", async () => {
        // Seller mints nft
        const { nftId, amount } = await mintAndApprove1155(
          seller,
          marketplaceContract.address,
          10000
        );

        const offer = [getTestItem1155(nftId, amount.mul(10), amount.mul(10))];

        const consideration = [
          {
            itemType: 0, // ETH
            token: constants.AddressZero,
            identifierOrCriteria: 0, // ignored for ETH
            startAmount: amount.mul(1000),
            endAmount: amount.mul(1000),
            recipient: seller.address,
          },
          {
            itemType: 0, // ETH
            token: constants.AddressZero,
            identifierOrCriteria: 0, // ignored for ETH
            startAmount: amount.mul(10),
            endAmount: amount.mul(10),
            recipient: zone.address,
          },
          {
            itemType: 0, // ETH
            token: constants.AddressZero,
            identifierOrCriteria: 0, // ignored for ETH
            startAmount: amount.mul(20),
            endAmount: amount.mul(20),
            recipient: owner.address,
          },
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          1 // PARTIAL_OPEN
        );

        let orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(false);
        expect(orderStatus.totalFilled).to.equal(0);
        expect(orderStatus.totalSize).to.equal(0);

        order.numerator = 2; // fill two tenths or one fifth
        order.denominator = 10; // fill two tenths or one fifth

        await withBalanceChecks([order], 0, [], async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ],
            null,
            []
          );
          return receipt;
        });

        orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(true);
        expect(orderStatus.totalFilled).to.equal(2);
        expect(orderStatus.totalSize).to.equal(10);

        order.numerator = 1; // fill one half
        order.denominator = 2; // fill one half

        await withBalanceChecks([order], 0, [], async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ],
            null,
            []
          );
          return receipt;
        });

        orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(true);
        expect(orderStatus.totalFilled).to.equal(14);
        expect(orderStatus.totalSize).to.equal(20);

        // Fill remaining; only 3/10ths will be fillable
        order.numerator = 1; // fill one half
        order.denominator = 2; // fill one half

        const ordersClone = JSON.parse(JSON.stringify([order]));
        for (const [i, clonedOrder] of Object.entries(ordersClone)) {
          clonedOrder.parameters.startTime = order.parameters.startTime;
          clonedOrder.parameters.endTime = order.parameters.endTime;

          for (const [j, offerItem] of Object.entries(
            clonedOrder.parameters.offer
          )) {
            offerItem.startAmount = order.parameters.offer[j].startAmount;
            offerItem.endAmount = order.parameters.offer[j].endAmount;
          }

          for (const [j, considerationItem] of Object.entries(
            clonedOrder.parameters.consideration
          )) {
            considerationItem.startAmount =
              order.parameters.consideration[j].startAmount;
            considerationItem.endAmount =
              order.parameters.consideration[j].endAmount;
          }
        }

        ordersClone[0].numerator = 3;
        ordersClone[0].denominator = 10;

        await withBalanceChecks(ordersClone, 0, [], async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order: ordersClone[0],
                orderHash,
                fulfiller: buyer.address,
              },
            ],
            null,
            []
          );
          return receipt;
        });

        orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(true);
        expect(orderStatus.totalFilled).to.equal(40);
        expect(orderStatus.totalSize).to.equal(40);
      });
      it("Partial fills (standard, additional permutations)", async () => {
        // Seller mints nft
        const { nftId, amount } = await mintAndApprove1155(
          seller,
          marketplaceContract.address,
          10000
        );

        const offer = [getTestItem1155(nftId, amount.mul(10), amount.mul(10))];

        const consideration = [
          {
            itemType: 0, // ETH
            token: constants.AddressZero,
            identifierOrCriteria: 0, // ignored for ETH
            startAmount: amount.mul(1000),
            endAmount: amount.mul(1000),
            recipient: seller.address,
          },
          {
            itemType: 0, // ETH
            token: constants.AddressZero,
            identifierOrCriteria: 0, // ignored for ETH
            startAmount: amount.mul(10),
            endAmount: amount.mul(10),
            recipient: zone.address,
          },
          {
            itemType: 0, // ETH
            token: constants.AddressZero,
            identifierOrCriteria: 0, // ignored for ETH
            startAmount: amount.mul(20),
            endAmount: amount.mul(20),
            recipient: owner.address,
          },
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          1 // PARTIAL_OPEN
        );

        let orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(false);
        expect(orderStatus.totalFilled).to.equal(0);
        expect(orderStatus.totalSize).to.equal(0);

        order.numerator = 2; // fill two tenths or one fifth
        order.denominator = 10; // fill two tenths or one fifth

        await withBalanceChecks([order], 0, [], async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ],
            null,
            []
          );
          return receipt;
        });

        orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(true);
        expect(orderStatus.totalFilled).to.equal(2);
        expect(orderStatus.totalSize).to.equal(10);

        order.numerator = 1; // fill one tenth
        order.denominator = 10; // fill one tenth

        await withBalanceChecks([order], 0, [], async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ],
            null,
            []
          );
          return receipt;
        });

        orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(true);
        expect(orderStatus.totalFilled).to.equal(3);
        expect(orderStatus.totalSize).to.equal(10);

        // Fill all available; only 7/10ths will be fillable
        order.numerator = 1; // fill all available
        order.denominator = 1; // fill all available

        const ordersClone = JSON.parse(JSON.stringify([order]));
        for (const [, clonedOrder] of Object.entries(ordersClone)) {
          clonedOrder.parameters.startTime = order.parameters.startTime;
          clonedOrder.parameters.endTime = order.parameters.endTime;

          for (const [j, offerItem] of Object.entries(
            clonedOrder.parameters.offer
          )) {
            offerItem.startAmount = order.parameters.offer[j].startAmount;
            offerItem.endAmount = order.parameters.offer[j].endAmount;
          }

          for (const [j, considerationItem] of Object.entries(
            clonedOrder.parameters.consideration
          )) {
            considerationItem.startAmount =
              order.parameters.consideration[j].startAmount;
            considerationItem.endAmount =
              order.parameters.consideration[j].endAmount;
          }
        }

        ordersClone[0].numerator = 7;
        ordersClone[0].denominator = 10;

        await withBalanceChecks(ordersClone, 0, [], async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order: ordersClone[0],
                orderHash,
                fulfiller: buyer.address,
              },
            ],
            null,
            []
          );
          return receipt;
        });

        orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(true);
        expect(orderStatus.totalFilled).to.equal(10);
        expect(orderStatus.totalSize).to.equal(10);
      });
      it("Partial fills (match)", async () => {
        // Seller mints nft
        const { nftId, amount } = await mintAndApprove1155(
          seller,
          marketplaceContract.address,
          10000
        );

        const offer = [getTestItem1155(nftId, amount.mul(10), amount.mul(10))];

        const consideration = [
          {
            itemType: 0, // ETH
            token: constants.AddressZero,
            identifierOrCriteria: 0, // ignored for ETH
            startAmount: amount.mul(1000),
            endAmount: amount.mul(1000),
            recipient: seller.address,
          },
          {
            itemType: 0, // ETH
            token: constants.AddressZero,
            identifierOrCriteria: 0, // ignored for ETH
            startAmount: amount.mul(10),
            endAmount: amount.mul(10),
            recipient: zone.address,
          },
          {
            itemType: 0, // ETH
            token: constants.AddressZero,
            identifierOrCriteria: 0, // ignored for ETH
            startAmount: amount.mul(20),
            endAmount: amount.mul(20),
            recipient: owner.address,
          },
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          1 // PARTIAL_OPEN
        );

        let orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(false);
        expect(orderStatus.totalFilled).to.equal(0);
        expect(orderStatus.totalSize).to.equal(0);

        order.numerator = 2; // fill two tenths or one fifth
        order.denominator = 10; // fill two tenths or one fifth

        let mirrorObject;
        mirrorObject = await createMirrorBuyNowOrder(buyer, zone, order);

        const fulfillments = defaultBuyNowMirrorFulfillment;

        let executions = await simulateAdvancedMatchOrders(
          [order, mirrorObject.mirrorOrder],
          [], // no criteria resolvers
          fulfillments,
          owner,
          value
        );

        expect(executions.length).to.equal(4);

        const tx = await marketplaceContract.connect(owner).matchAdvancedOrders(
          [order, mirrorObject.mirrorOrder],
          [], // no criteria resolvers
          fulfillments,
          {
            value,
          }
        );
        const receipt = await tx.wait();
        await checkExpectedEvents(
          receipt,
          [
            {
              order,
              orderHash,
              fulfiller: constants.AddressZero,
            },
          ],
          executions
        );
        await checkExpectedEvents(
          receipt,
          [
            {
              order: mirrorObject.mirrorOrder,
              orderHash: mirrorObject.mirrorOrderHash,
              fulfiller: constants.AddressZero,
            },
          ],
          executions
        );

        orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(true);
        expect(orderStatus.totalFilled).to.equal(2);
        expect(orderStatus.totalSize).to.equal(10);

        order.numerator = 1; // fill one tenth
        order.denominator = 10; // fill one tenth

        mirrorObject = await createMirrorBuyNowOrder(buyer, zone, order);

        executions = await simulateAdvancedMatchOrders(
          [order, mirrorObject.mirrorOrder],
          [], // no criteria resolvers
          fulfillments,
          owner,
          value
        );

        const tx2 = await marketplaceContract
          .connect(owner)
          .matchAdvancedOrders(
            [order, mirrorObject.mirrorOrder],
            [], // no criteria resolvers
            fulfillments,
            {
              value,
            }
          );
        const receipt2 = await tx2.wait();
        await checkExpectedEvents(
          receipt2,
          [
            {
              order,
              orderHash,
              fulfiller: constants.AddressZero,
            },
          ],
          executions
        );
        await checkExpectedEvents(
          receipt2,
          [
            {
              order: mirrorObject.mirrorOrder,
              orderHash: mirrorObject.mirrorOrderHash,
              fulfiller: constants.AddressZero,
            },
          ],
          executions
        );

        orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(true);
        expect(orderStatus.totalFilled).to.equal(3);
        expect(orderStatus.totalSize).to.equal(10);

        // Fill all available; only 7/10ths will be fillable
        order.numerator = 7; // fill all available
        order.denominator = 10; // fill all available

        mirrorObject = await createMirrorBuyNowOrder(buyer, zone, order);

        executions = await simulateAdvancedMatchOrders(
          [order, mirrorObject.mirrorOrder],
          [], // no criteria resolvers
          fulfillments,
          owner,
          value
        );

        const tx3 = await marketplaceContract
          .connect(owner)
          .matchAdvancedOrders(
            [order, mirrorObject.mirrorOrder],
            [], // no criteria resolvers
            fulfillments,
            {
              value,
            }
          );
        const receipt3 = await tx3.wait();
        await checkExpectedEvents(
          receipt3,
          [
            {
              order,
              orderHash,
              fulfiller: constants.AddressZero,
            },
          ],
          executions
        );
        await checkExpectedEvents(
          receipt3,
          [
            {
              order: mirrorObject.mirrorOrder,
              orderHash: mirrorObject.mirrorOrderHash,
              fulfiller: constants.AddressZero,
            },
          ],
          executions
        );
        return receipt3;
      });

      const orderStatus = await marketplaceContract.getOrderStatus(orderHash);

      expect(orderStatus.isCancelled).to.equal(false);
      expect(orderStatus.isValidated).to.equal(true);
      expect(orderStatus.totalFilled).to.equal(10);
      expect(orderStatus.totalSize).to.equal(10);
    });

    describe("Criteria-based orders", async () => {
      it("Criteria-based offer item (standard)", async () => {
        // Seller mints nfts
        const nftId = ethers.BigNumber.from(randomHex());
        const secondNFTId = ethers.BigNumber.from(randomHex());
        const thirdNFTId = ethers.BigNumber.from(randomHex());

        await testERC721.mint(seller.address, nftId);
        await testERC721.mint(seller.address, secondNFTId);
        await testERC721.mint(seller.address, thirdNFTId);

        const tokenIds = [nftId, secondNFTId, thirdNFTId];

        // Seller approves marketplace contract to transfer NFTs
        await set721ApprovalForAll(seller, marketplaceContract.address, true);

        const { root, proofs } = merkleTree(tokenIds);

        const offer = [
          {
            itemType: 4, // ERC721WithCriteria
            token: testERC721.address,
            identifierOrCriteria: root,
            startAmount: ethers.BigNumber.from(1),
            endAmount: ethers.BigNumber.from(1),
          },
        ];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const criteriaResolvers = [
          {
            orderIndex: 0,
            side: 0, // offer
            index: 0,
            identifier: nftId,
            criteriaProof: proofs[nftId.toString()],
          },
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0, // FULL_OPEN
          criteriaResolvers
        );

        await withBalanceChecks([order], 0, criteriaResolvers, async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, criteriaResolvers, toKey(false), {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ],
            null,
            criteriaResolvers
          );
          return receipt;
        });
      });
      it("Criteria-based offer item (standard, collection-level)", async () => {
        // Seller mints nfts
        const nftId = ethers.BigNumber.from(randomHex());
        const secondNFTId = ethers.BigNumber.from(randomHex());
        const thirdNFTId = ethers.BigNumber.from(randomHex());

        await testERC721.mint(seller.address, nftId);
        await testERC721.mint(seller.address, secondNFTId);
        await testERC721.mint(seller.address, thirdNFTId);

        // Seller approves marketplace contract to transfer NFTs
        await set721ApprovalForAll(seller, marketplaceContract.address, true);

        const offer = [
          {
            itemType: 4, // ERC721WithCriteria
            token: testERC721.address,
            identifierOrCriteria: ethers.constants.HashZero, // collection-level
            startAmount: ethers.BigNumber.from(1),
            endAmount: ethers.BigNumber.from(1),
          },
        ];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const criteriaResolvers = [
          {
            orderIndex: 0,
            side: 0, // offer
            index: 0,
            identifier: nftId,
            criteriaProof: [], // No proof on collection-level
          },
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0, // FULL_OPEN
          criteriaResolvers
        );

        await withBalanceChecks([order], 0, criteriaResolvers, async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, criteriaResolvers, toKey(false), {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ],
            null,
            criteriaResolvers
          );
          return receipt;
        });
      });
      it("Criteria-based offer item (match)", async () => {
        // Seller mints nfts
        const nftId = ethers.BigNumber.from(randomHex());
        const secondNFTId = ethers.BigNumber.from(randomHex());
        const thirdNFTId = ethers.BigNumber.from(randomHex());

        await testERC721.mint(seller.address, nftId);
        await testERC721.mint(seller.address, secondNFTId);
        await testERC721.mint(seller.address, thirdNFTId);

        const tokenIds = [nftId, secondNFTId, thirdNFTId];

        // Seller approves marketplace contract to transfer NFTs
        await set721ApprovalForAll(seller, marketplaceContract.address, true);

        const { root, proofs } = merkleTree(tokenIds);

        const offer = [
          {
            itemType: 4, // ERC721WithCriteria
            token: testERC721.address,
            identifierOrCriteria: root,
            startAmount: ethers.BigNumber.from(1),
            endAmount: ethers.BigNumber.from(1),
          },
        ];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const criteriaResolvers = [
          {
            orderIndex: 0,
            side: 0, // offer
            index: 0,
            identifier: nftId,
            criteriaProof: proofs[nftId.toString()],
          },
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0, // FULL_OPEN
          criteriaResolvers
        );

        const { mirrorOrder, mirrorOrderHash } =
          await createMirrorAcceptOfferOrder(
            buyer,
            zone,
            order,
            criteriaResolvers
          );

        const fulfillments = [
          [[[1, 0]], [[0, 0]]],
          [[[0, 0]], [[1, 0]]],
          [[[1, 1]], [[0, 1]]],
          [[[1, 2]], [[0, 2]]],
        ].map(([offerArr, considerationArr]) =>
          toFulfillment(offerArr, considerationArr)
        );

        const executions = await simulateAdvancedMatchOrders(
          [order, mirrorOrder],
          criteriaResolvers,
          fulfillments,
          owner,
          value
        );

        expect(executions.length).to.equal(4);

        await whileImpersonating(owner.address, provider, async () => {
          const tx = await marketplaceContract
            .connect(owner)
            .matchAdvancedOrders(
              [order, mirrorOrder],
              criteriaResolvers,
              fulfillments,
              {
                value,
              }
            );
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions,
            criteriaResolvers
          );
          await checkExpectedEvents(
            receipt,
            [
              {
                order: mirrorOrder,
                orderHash: mirrorOrderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          return receipt;
        });
      });
      it("Criteria-based consideration item (standard)", async () => {
        // buyer mints nfts
        const nftId = ethers.BigNumber.from(randomHex());
        const secondNFTId = ethers.BigNumber.from(randomHex());
        const thirdNFTId = ethers.BigNumber.from(randomHex());

        await testERC721.mint(buyer.address, nftId);
        await testERC721.mint(buyer.address, secondNFTId);
        await testERC721.mint(buyer.address, thirdNFTId);

        const tokenIds = [nftId, secondNFTId, thirdNFTId];

        // Seller approves marketplace contract to transfer NFTs
        await set721ApprovalForAll(buyer, marketplaceContract.address, true);

        const { root, proofs } = merkleTree(tokenIds);

        const offer = [getItemETH(10, 10)];

        const consideration = [
          {
            itemType: 4, // ERC721WithCriteria
            token: testERC721.address,
            identifierOrCriteria: root,
            startAmount: ethers.BigNumber.from(1),
            endAmount: ethers.BigNumber.from(1),
            recipient: seller.address,
          },
        ];

        const criteriaResolvers = [
          {
            orderIndex: 0,
            side: 1,
            index: 0,
            identifier: nftId,
            criteriaProof: proofs[nftId.toString()],
          },
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0, // FULL_OPEN
          criteriaResolvers
        );

        await withBalanceChecks(
          [order],
          value.mul(-1),
          criteriaResolvers,
          async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillAdvancedOrder(order, criteriaResolvers, toKey(false), {
                value,
              });
            const receipt = await tx.wait();
            await checkExpectedEvents(
              receipt,
              [
                {
                  order,
                  orderHash,
                  fulfiller: buyer.address,
                },
              ],
              null,
              criteriaResolvers
            );
            return receipt;
          }
        );
      });
      it("Criteria-based wildcard consideration item (standard)", async () => {
        // buyer mints nft
        const nftId = ethers.BigNumber.from(randomHex());

        await testERC721.mint(buyer.address, nftId);

        // Seller approves marketplace contract to transfer NFTs
        await set721ApprovalForAll(buyer, marketplaceContract.address, true);

        const offer = [getItemETH(10, 10)];

        const consideration = [
          {
            itemType: 4, // ERC721WithCriteria
            token: testERC721.address,
            identifierOrCriteria: ethers.constants.HashZero,
            startAmount: ethers.BigNumber.from(1),
            endAmount: ethers.BigNumber.from(1),
            recipient: seller.address,
          },
        ];

        const criteriaResolvers = [
          {
            orderIndex: 0,
            side: 1,
            index: 0,
            identifier: nftId,
            criteriaProof: [],
          },
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0, // FULL_OPEN
          criteriaResolvers
        );

        await withBalanceChecks(
          [order],
          value.mul(-1),
          criteriaResolvers,
          async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillAdvancedOrder(order, criteriaResolvers, toKey(false), {
                value,
              });
            const receipt = await tx.wait();
            await checkExpectedEvents(
              receipt,
              [
                {
                  order,
                  orderHash,
                  fulfiller: buyer.address,
                },
              ],
              null,
              criteriaResolvers
            );
            return receipt;
          }
        );
      });
      it("Criteria-based consideration item (match)", async () => {
        // Fulfiller mints nft
        const nftId = ethers.BigNumber.from(randomHex());
        await testERC721.mint(buyer.address, nftId);
        const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);

        // Fulfiller approves marketplace contract to transfer NFT
        await set721ApprovalForAll(buyer, marketplaceContract.address, true);

        // Offerer mints ERC20
        await mintAndApproveERC20(
          seller,
          marketplaceContract.address,
          tokenAmount
        );

        // Fulfiller mints ERC20
        await mintAndApproveERC20(
          buyer,
          marketplaceContract.address,
          tokenAmount
        );

        const { root, proofs } = merkleTree([nftId]);

        const offer = [
          // Offerer (Seller)
          getTestItem20(tokenAmount.sub(100), tokenAmount.sub(100)),
        ];

        const consideration = [
          // Fulfiller (Buyer)
          {
            itemType: 4, // ERC721WithCriteria
            token: testERC721.address,
            identifierOrCriteria: root,
            startAmount: ethers.BigNumber.from(1),
            endAmount: ethers.BigNumber.from(1),
            recipient: seller.address,
          },
          getTestItem20(50, 50, zone.address),
          getTestItem20(50, 50, owner.address),
        ];

        const criteriaResolvers = [
          {
            orderIndex: 0,
            side: 1,
            index: 0,
            identifier: nftId,
            criteriaProof: proofs[nftId.toString()],
          },
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0, // FULL_OPEN
          criteriaResolvers
        );

        const { mirrorOrder, mirrorOrderHash } =
          await createMirrorAcceptOfferOrder(
            buyer,
            zone,
            order,
            criteriaResolvers
          );

        const fulfillments = defaultAcceptOfferMirrorFulfillment;

        const executions = await simulateAdvancedMatchOrders(
          [order, mirrorOrder],
          criteriaResolvers,
          fulfillments,
          owner,
          value
        );

        expect(executions.length).to.equal(4);

        const tx = await marketplaceContract
          .connect(owner)
          .matchAdvancedOrders(
            [order, mirrorOrder],
            criteriaResolvers,
            fulfillments,
            {
              value,
            }
          );
        const receipt = await tx.wait();
        await checkExpectedEvents(
          receipt,
          [
            {
              order,
              orderHash,
              fulfiller: constants.AddressZero,
            },
          ],
          executions,
          criteriaResolvers
        );
        await checkExpectedEvents(
          receipt,
          [
            {
              order: mirrorOrder,
              orderHash: mirrorOrderHash,
              fulfiller: constants.AddressZero,
            },
          ],
          executions
        );
        return receipt;
      });
    });

    describe("Ascending / Descending amounts", async () => {
      it("Ascending offer amount (standard)", async () => {
        // Seller mints nft
        const nftId = ethers.BigNumber.from(randomHex());
        const startAmount = ethers.BigNumber.from(randomHex().slice(0, 5));
        const endAmount = startAmount.mul(2);
        await testERC1155.mint(seller.address, nftId, endAmount.mul(10));

        // Seller approves marketplace contract to transfer NFTs

        await set1155ApprovalForAll(seller, marketplaceContract.address, true);

        const offer = [
          getTestItem1155(nftId, startAmount, endAmount, undefined),
        ];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        let orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(false);
        expect(orderStatus.totalFilled).to.equal(0);
        expect(orderStatus.totalSize).to.equal(0);

        await withBalanceChecks([order], 0, [], async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ],
            null,
            []
          );
          return receipt;
        });

        orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(true);
        expect(orderStatus.totalFilled).to.equal(1);
        expect(orderStatus.totalSize).to.equal(1);
      });
      it("Ascending consideration amount (standard)", async () => {
        // Seller mints ERC20
        const tokenAmount = ethers.BigNumber.from(randomLarge());
        await mintAndApproveERC20(
          seller,
          marketplaceContract.address,
          tokenAmount
        );

        // Buyer mints nft
        const nftId = ethers.BigNumber.from(randomHex());
        const startAmount = ethers.BigNumber.from(randomHex().slice(0, 5));
        const endAmount = startAmount.mul(2);
        await testERC1155.mint(buyer.address, nftId, endAmount.mul(10));

        // Buyer approves marketplace contract to transfer NFTs
        await set1155ApprovalForAll(buyer, marketplaceContract.address, true);

        // Buyer needs to approve marketplace to transfer ERC20 tokens too (as it's a standard fulfillment)
        await expect(
          testERC20
            .connect(buyer)
            .approve(marketplaceContract.address, tokenAmount)
        )
          .to.emit(testERC20, "Approval")
          .withArgs(buyer.address, marketplaceContract.address, tokenAmount);

        const offer = [getTestItem20(tokenAmount, tokenAmount)];

        const consideration = [
          getTestItem1155(
            nftId,
            startAmount,
            endAmount,
            undefined,
            seller.address
          ),
          getTestItem20(50, 50, zone.address),
          getTestItem20(50, 50, owner.address),
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        let orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(false);
        expect(orderStatus.totalFilled).to.equal(0);
        expect(orderStatus.totalSize).to.equal(0);

        await withBalanceChecks([order], 0, [], async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ],
            null,
            []
          );
          return receipt;
        });

        orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(true);
        expect(orderStatus.totalFilled).to.equal(1);
        expect(orderStatus.totalSize).to.equal(1);
      });
      it("Ascending offer amount (match)", async () => {
        // Seller mints nft
        const nftId = ethers.BigNumber.from(randomHex());
        const startAmount = ethers.BigNumber.from(randomHex().slice(0, 5));
        const endAmount = startAmount.mul(2);
        await testERC1155.mint(seller.address, nftId, endAmount.mul(10));

        // Seller approves marketplace contract to transfer NFTs

        await set1155ApprovalForAll(seller, marketplaceContract.address, true);

        const offer = [
          getTestItem1155(nftId, startAmount, endAmount, undefined),
        ];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        let orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(false);
        expect(orderStatus.totalFilled).to.equal(0);
        expect(orderStatus.totalSize).to.equal(0);

        const { mirrorOrder, mirrorOrderHash } = await createMirrorBuyNowOrder(
          buyer,
          zone,
          order
        );

        const fulfillments = defaultBuyNowMirrorFulfillment;

        const executions = await simulateMatchOrders(
          [order, mirrorOrder],
          fulfillments,
          owner,
          value
        );

        expect(executions.length).to.equal(4);

        const tx = await marketplaceContract
          .connect(owner)
          .matchOrders([order, mirrorOrder], fulfillments, {
            value,
          });
        const receipt = await tx.wait();
        await checkExpectedEvents(
          receipt,
          [
            {
              order,
              orderHash,
              fulfiller: constants.AddressZero,
            },
          ],
          executions
        );
        await checkExpectedEvents(
          receipt,
          [
            {
              order: mirrorOrder,
              orderHash: mirrorOrderHash,
              fulfiller: constants.AddressZero,
            },
          ],
          executions
        );

        orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(true);
        expect(orderStatus.totalFilled).to.equal(1);
        expect(orderStatus.totalSize).to.equal(1);
      });
      it.skip("Ascending consideration amount (match)", async () => {});
      it.skip("Ascending amount + partial fill (standard)", async () => {});
      it.skip("Ascending amount + partial fill (match)", async () => {});
      it.skip("Descending offer amount (standard)", async () => {
        // Seller mints nft
        const nftId = ethers.BigNumber.from(randomHex());
        const endAmount = ethers.BigNumber.from(randomHex().slice(0, 5));
        const startAmount = endAmount.div(2);

        await testERC1155.mint(seller.address, nftId, endAmount.mul(10));

        // Seller approves marketplace contract to transfer NFTs

        await set1155ApprovalForAll(seller, marketplaceContract.address, true);

        const offer = [
          getTestItem1155(nftId, startAmount, endAmount, undefined),
        ];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        let orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(false);
        expect(orderStatus.totalFilled).to.equal(0);
        expect(orderStatus.totalSize).to.equal(0);

        await withBalanceChecks([order], 0, [], async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ],
            null,
            []
          );
          return receipt;
        });

        orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(true);
        expect(orderStatus.totalFilled).to.equal(1);
        expect(orderStatus.totalSize).to.equal(1);
      });
      it.skip("Descending consideration amount (standard)", async () => {
        // Seller mints ERC20
        const tokenAmount = ethers.BigNumber.from(randomLarge());
        await mintAndApproveERC20(
          seller,
          marketplaceContract.address,
          tokenAmount
        );

        // Buyer mints nft
        const nftId = ethers.BigNumber.from(randomHex());
        const endAmount = ethers.BigNumber.from(randomHex().slice(0, 5));
        const startAmount = endAmount.div(2);

        await testERC1155.mint(buyer.address, nftId, endAmount.mul(10));

        // Buyer approves marketplace contract to transfer NFTs
        await set1155ApprovalForAll(buyer, marketplaceContract.address, true);

        // Buyer needs to approve marketplace to transfer ERC20 tokens too (as it's a standard fulfillment)
        await expect(
          testERC20
            .connect(buyer)
            .approve(marketplaceContract.address, tokenAmount)
        )
          .to.emit(testERC20, "Approval")
          .withArgs(buyer.address, marketplaceContract.address, tokenAmount);

        const offer = [getTestItem20(tokenAmount, tokenAmount)];

        const consideration = [
          getTestItem1155(
            nftId,
            startAmount,
            endAmount,
            undefined,
            seller.address
          ),
          getTestItem20(50, 50, zone.address),
          getTestItem20(50, 50, owner.address),
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        let orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(false);
        expect(orderStatus.totalFilled).to.equal(0);
        expect(orderStatus.totalSize).to.equal(0);

        await withBalanceChecks([order], 0, [], async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ],
            null,
            []
          );
          return receipt;
        });

        orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(true);
        expect(orderStatus.totalFilled).to.equal(1);
        expect(orderStatus.totalSize).to.equal(1);
      });
      it.skip("Descending offer amount (match)", async () => {});
      it.skip("Descending consideration amount (match)", async () => {});
      it.skip("Descending amount + partial fill (standard)", async () => {});
      it.skip("Descending amount + partial fill (match)", async () => {});
    });

    describe("Sequenced Orders", async () => {
      it("Match A => B => C => A", async () => {
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );
        const secondNFTId = await mintAndApprove721(
          buyer,
          marketplaceContract.address
        );
        const thirdNFTId = await mintAndApprove721(
          owner,
          marketplaceContract.address
        );

        const offerOne = [
          {
            itemType: 2, // ERC721
            token: testERC721.address,
            identifierOrCriteria: nftId,
            startAmount: ethers.BigNumber.from(1),
            endAmount: ethers.BigNumber.from(1),
          },
        ];

        const considerationOne = [
          {
            itemType: 2, // ERC721
            token: testERC721.address,
            identifierOrCriteria: secondNFTId,
            startAmount: ethers.BigNumber.from(1),
            endAmount: ethers.BigNumber.from(1),
            recipient: seller.address,
          },
        ];

        const { order: orderOne, orderHash: orderHashOne } = await createOrder(
          seller,
          zone,
          offerOne,
          considerationOne,
          0 // FULL_OPEN
        );

        const offerTwo = [
          {
            itemType: 2, // ERC721
            token: testERC721.address,
            identifierOrCriteria: secondNFTId,
            startAmount: ethers.BigNumber.from(1),
            endAmount: ethers.BigNumber.from(1),
          },
        ];

        const considerationTwo = [
          {
            itemType: 2, // ERC721
            token: testERC721.address,
            identifierOrCriteria: thirdNFTId,
            startAmount: ethers.BigNumber.from(1),
            endAmount: ethers.BigNumber.from(1),
            recipient: buyer.address,
          },
        ];

        const { order: orderTwo, orderHash: orderHashTwo } = await createOrder(
          buyer,
          zone,
          offerTwo,
          considerationTwo,
          0 // FULL_OPEN
        );

        const offerThree = [
          {
            itemType: 2, // ERC721
            token: testERC721.address,
            identifierOrCriteria: thirdNFTId,
            startAmount: ethers.BigNumber.from(1),
            endAmount: ethers.BigNumber.from(1),
          },
        ];

        const considerationThree = [
          {
            itemType: 2, // ERC721
            token: testERC721.address,
            identifierOrCriteria: nftId,
            startAmount: ethers.BigNumber.from(1),
            endAmount: ethers.BigNumber.from(1),
            recipient: owner.address,
          },
        ];

        const { order: orderThree, orderHash: orderHashThree } =
          await createOrder(
            owner,
            zone,
            offerThree,
            considerationThree,
            0 // FULL_OPEN
          );

        const fulfillments = [
          [[[1, 0]], [[0, 0]]],
          [[[0, 0]], [[2, 0]]],
          [[[2, 0]], [[1, 0]]],
        ].map(([offerArr, considerationArr]) =>
          toFulfillment(offerArr, considerationArr)
        );

        const executions = await simulateAdvancedMatchOrders(
          [orderOne, orderTwo, orderThree],
          [], // no criteria resolvers
          fulfillments,
          owner,
          0 // no value
        );

        expect(executions.length).to.equal(fulfillments.length);

        const tx = await marketplaceContract
          .connect(owner)
          .matchAdvancedOrders(
            [orderOne, orderTwo, orderThree],
            [],
            fulfillments,
            {
              value: 0,
            }
          );
        const receipt = await tx.wait();
        await checkExpectedEvents(
          receipt,
          [
            {
              order: orderOne,
              orderHash: orderHashOne,
              fulfiller: constants.AddressZero,
            },
          ],
          executions
        );
        await checkExpectedEvents(
          receipt,
          [
            {
              order: orderTwo,
              orderHash: orderHashTwo,
              fulfiller: constants.AddressZero,
            },
          ],
          executions
        );
        await checkExpectedEvents(
          receipt,
          [
            {
              order: orderThree,
              orderHash: orderHashThree,
              fulfiller: constants.AddressZero,
            },
          ],
          executions
        );
      });
      it("Match with fewer executions when one party has multiple orders that coincide", async () => {
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );
        const secondNFTId = await mintAndApprove721(
          buyer,
          marketplaceContract.address
        );

        const offerOne = [
          {
            itemType: 2, // ERC721
            token: testERC721.address,
            identifierOrCriteria: nftId,
            startAmount: ethers.BigNumber.from(1),
            endAmount: ethers.BigNumber.from(1),
          },
        ];

        const considerationOne = [getItemETH(10, 10, seller.address)];

        const { order: orderOne, orderHash: orderHashOne } = await createOrder(
          seller,
          zone,
          offerOne,
          considerationOne,
          0 // FULL_OPEN
        );

        const offerTwo = [getItemETH(10, 10)];

        const considerationTwo = [
          {
            itemType: 2, // ERC721
            token: testERC721.address,
            identifierOrCriteria: secondNFTId,
            startAmount: ethers.BigNumber.from(1),
            endAmount: ethers.BigNumber.from(1),
            recipient: seller.address,
          },
        ];

        const { order: orderTwo, orderHash: orderHashTwo } = await createOrder(
          seller,
          zone,
          offerTwo,
          considerationTwo,
          0 // FULL_OPEN
        );

        const offerThree = [
          {
            itemType: 2, // ERC721
            token: testERC721.address,
            identifierOrCriteria: secondNFTId,
            startAmount: ethers.BigNumber.from(1),
            endAmount: ethers.BigNumber.from(1),
          },
        ];

        const considerationThree = [
          {
            itemType: 2, // ERC721
            token: testERC721.address,
            identifierOrCriteria: nftId,
            startAmount: ethers.BigNumber.from(1),
            endAmount: ethers.BigNumber.from(1),
            recipient: buyer.address,
          },
        ];

        const { order: orderThree, orderHash: orderHashThree } =
          await createOrder(
            buyer,
            zone,
            offerThree,
            considerationThree,
            0 // FULL_OPEN
          );

        const fulfillments = [
          [[[1, 0]], [[0, 0]]],
          [[[0, 0]], [[2, 0]]],
          [[[2, 0]], [[1, 0]]],
        ].map(([offerArr, considerationArr]) =>
          toFulfillment(offerArr, considerationArr)
        );

        const executions = await simulateAdvancedMatchOrders(
          [orderOne, orderTwo, orderThree],
          [], // no criteria resolvers
          fulfillments,
          owner,
          0 // no value
        );

        expect(executions.length).to.equal(fulfillments.length - 1);

        const tx = await marketplaceContract
          .connect(owner)
          .matchAdvancedOrders(
            [orderOne, orderTwo, orderThree],
            [],
            fulfillments,
            {
              value: 0,
            }
          );
        const receipt = await tx.wait();
        await checkExpectedEvents(
          receipt,
          [
            {
              order: orderOne,
              orderHash: orderHashOne,
              fulfiller: constants.AddressZero,
            },
          ],
          executions
        );
        await checkExpectedEvents(
          receipt,
          [
            {
              order: orderTwo,
              orderHash: orderHashTwo,
              fulfiller: constants.AddressZero,
            },
          ],
          executions
        );
        await checkExpectedEvents(
          receipt,
          [
            {
              order: orderThree,
              orderHash: orderHashThree,
              fulfiller: constants.AddressZero,
            },
          ],
          executions
        );
        return receipt;
      });
    });

    describe("Order groups", async () => {
      it("Multiple offer components at once", async () => {
        // Seller mints NFTs
        const nftId = ethers.BigNumber.from(randomHex().slice(0, 10));
        const amount = ethers.BigNumber.from(randomHex().slice(0, 10));
        await testERC1155.mint(seller.address, nftId, amount.mul(2));

        // Seller approves marketplace contract to transfer NFT

        await set1155ApprovalForAll(seller, marketplaceContract.address, true);

        // Buyer mints ERC20s
        const tokenAmount = ethers.BigNumber.from(randomLarge());
        await mintAndApproveERC20(
          buyer,
          marketplaceContract.address,
          tokenAmount.mul(2)
        );

        const offerOne = [getTestItem1155(nftId, amount, amount)];

        const considerationOne = [
          getTestItem20(tokenAmount, tokenAmount, seller.address),
        ];

        const { order: orderOne, orderHash: orderHashOne } = await createOrder(
          seller,
          zone,
          offerOne,
          considerationOne,
          0 // FULL_OPEN
        );

        const offerTwo = [getTestItem1155(nftId, amount, amount)];

        const considerationTwo = [
          getTestItem20(tokenAmount, tokenAmount, seller.address),
        ];

        const { order: orderTwo, orderHash: orderHashTwo } = await createOrder(
          seller,
          zone,
          offerTwo,
          considerationTwo,
          0 // FULL_OPEN
        );

        const offerThree = [
          getTestItem20(tokenAmount.mul(2), tokenAmount.mul(2)),
        ];

        const considerationThree = [
          getTestItem1155(
            nftId,
            amount.mul(2),
            amount.mul(2),
            undefined,
            buyer.address
          ),
        ];

        const { order: orderThree, orderHash: orderHashThree } =
          await createOrder(
            buyer,
            zone,
            offerThree,
            considerationThree,
            0 // FULL_OPEN
          );

        const fulfillments = [
          [
            [
              [0, 0],
              [1, 0],
            ],
            [[2, 0]],
          ],
          [[[2, 0]], [[0, 0]]],
          [[[2, 0]], [[1, 0]]],
        ].map(([offerArr, considerationArr]) =>
          toFulfillment(offerArr, considerationArr)
        );

        const executions = await simulateAdvancedMatchOrders(
          [orderOne, orderTwo, orderThree],
          [], // no criteria resolvers
          fulfillments,
          owner,
          0 // no value
        );

        expect(executions.length).to.equal(fulfillments.length);

        const tx = await marketplaceContract
          .connect(buyer)
          .matchAdvancedOrders(
            [orderOne, orderTwo, orderThree],
            [],
            fulfillments,
            {
              value: 0,
            }
          );
        const receipt = await tx.wait();
        await checkExpectedEvents(
          receipt,
          [
            {
              order: orderOne,
              orderHash: orderHashOne,
              fulfiller: constants.AddressZero,
            },
          ],
          executions,
          [],
          true
        );
        await checkExpectedEvents(
          receipt,
          [
            {
              order: orderTwo,
              orderHash: orderHashTwo,
              fulfiller: constants.AddressZero,
            },
          ],
          executions,
          [],
          true
        );
        await checkExpectedEvents(
          receipt,
          [
            {
              order: orderThree,
              orderHash: orderHashThree,
              fulfiller: constants.AddressZero,
            },
          ],
          executions
        );

        expect(
          ethers.BigNumber.from(
            "0x" + receipt.events[3].data.slice(66)
          ).toString()
        ).to.equal(amount.mul(2).toString());

        return receipt;
      });
      it("Multiple consideration components at once", async () => {
        // Seller mints NFTs
        const nftId = ethers.BigNumber.from(randomHex().slice(0, 10));
        const amount = ethers.BigNumber.from(randomHex().slice(0, 10));
        await testERC1155.mint(seller.address, nftId, amount.mul(2));

        // Seller approves marketplace contract to transfer NFT

        await set1155ApprovalForAll(seller, marketplaceContract.address, true);

        // Buyer mints ERC20s
        const tokenAmount = ethers.BigNumber.from(randomLarge());
        await mintAndApproveERC20(
          buyer,
          marketplaceContract.address,
          tokenAmount.mul(2)
        );

        const offerOne = [
          getTestItem1155(nftId, amount.mul(2), amount.mul(2), undefined),
        ];

        const considerationOne = [
          getTestItem20(tokenAmount.mul(2), tokenAmount.mul(2), seller.address),
        ];

        const { order: orderOne, orderHash: orderHashOne } = await createOrder(
          seller,
          zone,
          offerOne,
          considerationOne,
          0 // FULL_OPEN
        );

        const offerTwo = [getTestItem20(tokenAmount, tokenAmount)];

        const considerationTwo = [
          getTestItem1155(nftId, amount, amount, undefined, buyer.address),
        ];

        const { order: orderTwo, orderHash: orderHashTwo } = await createOrder(
          buyer,
          zone,
          offerTwo,
          considerationTwo,
          0 // FULL_OPEN
        );

        const offerThree = [getTestItem20(tokenAmount, tokenAmount)];

        const considerationThree = [
          getTestItem1155(nftId, amount, amount, undefined, buyer.address),
        ];

        const { order: orderThree, orderHash: orderHashThree } =
          await createOrder(
            buyer,
            zone,
            offerThree,
            considerationThree,
            0 // FULL_OPEN
          );

        const fulfillments = [
          [
            [[0, 0]],
            [
              [1, 0],
              [2, 0],
            ],
          ],
          [[[1, 0]], [[0, 0]]],
          [[[2, 0]], [[0, 0]]],
        ].map(([offerArr, considerationArr]) =>
          toFulfillment(offerArr, considerationArr)
        );

        const executions = await simulateAdvancedMatchOrders(
          [orderOne, orderTwo, orderThree],
          [], // no criteria resolvers
          fulfillments,
          owner,
          0 // no value
        );

        expect(executions.length).to.equal(fulfillments.length);

        await whileImpersonating(buyer.address, provider, async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .matchAdvancedOrders(
              [orderOne, orderTwo, orderThree],
              [],
              fulfillments,
              {
                value: 0,
              }
            );
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order: orderOne,
                orderHash: orderHashOne,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          await checkExpectedEvents(
            receipt,
            [
              {
                order: orderTwo,
                orderHash: orderHashTwo,
                fulfiller: constants.AddressZero,
              },
            ],
            executions,
            [],
            true
          );
          await checkExpectedEvents(
            receipt,
            [
              {
                order: orderThree,
                orderHash: orderHashThree,
                fulfiller: constants.AddressZero,
              },
            ],
            executions,
            [],
            true
          );

          // TODO: inlcude balance checks on the duplicate ERC20 transfers

          return receipt;
        });
      });
    });

    describe("Complex ERC1155 transfers", async () => {
      it("ERC1155 <=> ETH (match)", async () => {
        // Seller mints first nft
        const { nftId, amount } = await mint1155(seller);

        // Seller mints second nft
        const { nftId: secondNftId, amount: secondAmount } = await mint1155(
          seller
        );

        // Seller approves marketplace contract to transfer NFT

        await set1155ApprovalForAll(seller, marketplaceContract.address, true);

        const offer = [
          getTestItem1155(nftId, amount, amount, undefined),
          getTestItem1155(secondNftId, secondAmount, secondAmount),
        ];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const { mirrorOrder, mirrorOrderHash } = await createMirrorBuyNowOrder(
          buyer,
          zone,
          order
        );

        const fulfillments = [
          [[[0, 0]], [[1, 0]]],
          [[[0, 1]], [[1, 1]]],
          [[[1, 0]], [[0, 0]]],
          [[[1, 0]], [[0, 1]]],
          [[[1, 0]], [[0, 2]]],
        ].map(([offerArr, considerationArr]) =>
          toFulfillment(offerArr, considerationArr)
        );

        const executions = await simulateMatchOrders(
          [order, mirrorOrder],
          fulfillments,
          owner,
          value
        );

        expect(executions.length).to.equal(5);

        await whileImpersonating(owner.address, provider, async () => {
          const tx = await marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments, {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          await checkExpectedEvents(
            receipt,
            [
              {
                order: mirrorOrder,
                orderHash: mirrorOrderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          return receipt;
        });
      });
      it("ERC1155 <=> ETH (match, three items)", async () => {
        // Seller mints first nft
        const { nftId, amount } = await mint1155(seller);

        // Seller mints second nft
        const { nftId: secondNftId, amount: secondAmount } = await mint1155(
          seller
        );

        // Seller mints third nft
        const { nftId: thirdNftId, amount: thirdAmount } = await mint1155(
          seller
        );

        // Seller approves marketplace contract to transfer NFT

        await set1155ApprovalForAll(seller, marketplaceContract.address, true);

        const offer = [
          getTestItem1155(nftId, amount, amount, undefined),
          getTestItem1155(secondNftId, secondAmount, secondAmount),
          getTestItem1155(thirdNftId, thirdAmount, thirdAmount),
        ];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const { mirrorOrder, mirrorOrderHash } = await createMirrorBuyNowOrder(
          buyer,
          zone,
          order
        );

        const fulfillments = [
          [[[0, 0]], [[1, 0]]],
          [[[0, 1]], [[1, 1]]],
          [[[0, 2]], [[1, 2]]],
          [[[1, 0]], [[0, 0]]],
          [[[1, 0]], [[0, 1]]],
          [[[1, 0]], [[0, 2]]],
        ].map(([offerArr, considerationArr]) =>
          toFulfillment(offerArr, considerationArr)
        );

        const executions = await simulateMatchOrders(
          [order, mirrorOrder],
          fulfillments,
          owner,
          value
        );

        expect(executions.length).to.equal(6);

        await whileImpersonating(owner.address, provider, async () => {
          const tx = await marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments, {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          await checkExpectedEvents(
            receipt,
            [
              {
                order: mirrorOrder,
                orderHash: mirrorOrderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          return receipt;
        });
      });
      it("ERC1155 <=> ETH (match via conduit)", async () => {
        // Seller mints first nft
        const { nftId, amount } = await mint1155(seller);

        // Seller mints second nft
        const { nftId: secondNftId, amount: secondAmount } = await mint1155(
          seller
        );

        // Seller approves conduit contract to transfer NFT
        await set1155ApprovalForAll(seller, conduitOne.address, true);

        const offer = [
          getTestItem1155(nftId, amount, amount, undefined),
          getTestItem1155(secondNftId, secondAmount, secondAmount),
        ];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0, // FULL_OPEN
          [],
          null,
          seller,
          constants.HashZero,
          conduitKeyOne
        );

        const { mirrorOrder, mirrorOrderHash } = await createMirrorBuyNowOrder(
          buyer,
          zone,
          order
        );

        const fulfillments = [
          [[[0, 0]], [[1, 0]]],
          [[[0, 1]], [[1, 1]]],
          [[[1, 0]], [[0, 0]]],
          [[[1, 0]], [[0, 1]]],
          [[[1, 0]], [[0, 2]]],
        ].map(([offerArr, considerationArr]) =>
          toFulfillment(offerArr, considerationArr)
        );

        const executions = await simulateMatchOrders(
          [order, mirrorOrder],
          fulfillments,
          owner,
          value
        );

        expect(executions.length).to.equal(5);

        await whileImpersonating(owner.address, provider, async () => {
          const tx = await marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments, {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          await checkExpectedEvents(
            receipt,
            [
              {
                order: mirrorOrder,
                orderHash: mirrorOrderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          return receipt;
        });
      });
      it("ERC1155 <=> ETH (match, single item)", async () => {
        // Seller mints first nft
        const { nftId, amount } = await mint1155(seller);

        // Seller mints second nft
        const { nftId: secondNftId, amount: secondAmount } = await mint1155(
          seller
        );

        // Seller approves marketplace contract to transfer NFT

        await set1155ApprovalForAll(seller, marketplaceContract.address, true);

        const offer = [getTestItem1155(nftId, amount, amount, undefined)];

        const consideration = [];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const { mirrorOrder, mirrorOrderHash } = await createMirrorBuyNowOrder(
          buyer,
          zone,
          order
        );

        const fulfillments = [toFulfillment([[0, 0]], [[1, 0]])];

        const executions = await simulateMatchOrders(
          [order, mirrorOrder],
          fulfillments,
          owner,
          value
        );

        expect(executions.length).to.equal(1);

        await whileImpersonating(owner.address, provider, async () => {
          const tx = await marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments, {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          await checkExpectedEvents(
            receipt,
            [
              {
                order: mirrorOrder,
                orderHash: mirrorOrderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          return receipt;
        });
      });
      it("ERC1155 <=> ETH (match, single 1155)", async () => {
        // Seller mints first nft
        const { nftId, amount } = await mint1155(seller);

        // Seller mints second nft
        const { nftId: secondNftId, amount: secondAmount } = await mint1155(
          seller
        );

        // Seller approves marketplace contract to transfer NFT

        await set1155ApprovalForAll(seller, marketplaceContract.address, true);

        const offer = [getTestItem1155(nftId, amount, amount, undefined)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const { mirrorOrder, mirrorOrderHash } = await createMirrorBuyNowOrder(
          buyer,
          zone,
          order
        );

        const fulfillments = [
          [[[0, 0]], [[1, 0]]],
          [[[1, 0]], [[0, 0]]],
          [[[1, 0]], [[0, 1]]],
          [[[1, 0]], [[0, 2]]],
        ].map(([offerArr, considerationArr]) =>
          toFulfillment(offerArr, considerationArr)
        );

        const executions = await simulateMatchOrders(
          [order, mirrorOrder],
          fulfillments,
          owner,
          value
        );

        expect(executions.length).to.equal(4);

        await whileImpersonating(owner.address, provider, async () => {
          const tx = await marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments, {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          await checkExpectedEvents(
            receipt,
            [
              {
                order: mirrorOrder,
                orderHash: mirrorOrderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          return receipt;
        });
      });
      it("ERC1155 <=> ETH (match, two different 1155 contracts)", async () => {
        // Seller mints first nft
        const { nftId, amount } = await mint1155(seller);

        // Seller mints second nft
        const secondNftId = ethers.BigNumber.from(randomHex().slice(0, 10));
        const secondAmount = ethers.BigNumber.from(randomHex().slice(0, 10));
        await testERC1155Two.mint(seller.address, secondNftId, secondAmount);

        // Seller approves marketplace contract to transfer NFTs

        await set1155ApprovalForAll(seller, marketplaceContract.address, true);

        await expect(
          testERC1155Two
            .connect(seller)
            .setApprovalForAll(marketplaceContract.address, true)
        )
          .to.emit(testERC1155Two, "ApprovalForAll")
          .withArgs(seller.address, marketplaceContract.address, true);

        const offer = [
          getTestItem1155(nftId, amount, amount, undefined),
          getTestItem1155(
            secondNftId,
            secondAmount,
            secondAmount,
            testERC1155Two.address
          ),
        ];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const { mirrorOrder } = await createMirrorBuyNowOrder(
          buyer,
          zone,
          order
        );

        const fulfillments = [
          [[[0, 0]], [[1, 0]]],
          [[[0, 1]], [[1, 1]]],
          [[[1, 0]], [[0, 0]]],
          [[[1, 0]], [[0, 1]]],
          [[[1, 0]], [[0, 2]]],
        ].map(([offerArr, considerationArr]) =>
          toFulfillment(offerArr, considerationArr)
        );

        const executions = await simulateMatchOrders(
          [order, mirrorOrder],
          fulfillments,
          owner,
          value
        );

        expect(executions.length).to.equal(5);

        const tx = await marketplaceContract
          .connect(owner)
          .matchOrders([order, mirrorOrder], fulfillments, {
            value,
          });
        const receipt = await tx.wait();
        // TODO: check events (need to account for second 1155 token)
        return receipt;
      });
      it("ERC1155 <=> ETH (match, one single and one with two 1155's)", async () => {
        // Seller mints first nft
        const { nftId, amount } = await mintAndApprove1155(
          seller,
          marketplaceContract.address
        );

        // Seller mints second nft
        const secondNftId = ethers.BigNumber.from(randomHex().slice(0, 10));
        const secondAmount = ethers.BigNumber.from(randomHex().slice(0, 10));
        await testERC1155Two.mint(seller.address, secondNftId, secondAmount);

        // Seller mints third nft
        const { nftId: thirdNftId, amount: thirdAmount } = await mint1155(
          seller
        );

        // Seller approves marketplace contract to transfer NFTs

        await expect(
          testERC1155Two
            .connect(seller)
            .setApprovalForAll(marketplaceContract.address, true)
        )
          .to.emit(testERC1155Two, "ApprovalForAll")
          .withArgs(seller.address, marketplaceContract.address, true);

        const offer = [
          getTestItem1155(nftId, amount, amount, undefined),
          getTestItem1155(
            secondNftId,
            secondAmount,
            secondAmount,
            testERC1155Two.address
          ),
          getTestItem1155(thirdNftId, thirdAmount, thirdAmount),
        ];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const { mirrorOrder } = await createMirrorBuyNowOrder(
          buyer,
          zone,
          order
        );

        const fulfillments = [
          [[[0, 0]], [[1, 0]]],
          [[[0, 1]], [[1, 1]]],
          [[[0, 2]], [[1, 2]]],
          [[[1, 0]], [[0, 0]]],
          [[[1, 0]], [[0, 1]]],
          [[[1, 0]], [[0, 2]]],
        ].map(([offerArr, considerationArr]) =>
          toFulfillment(offerArr, considerationArr)
        );

        const executions = await simulateMatchOrders(
          [order, mirrorOrder],
          fulfillments,
          owner,
          value
        );

        expect(executions.length).to.equal(6);

        const tx = await marketplaceContract
          .connect(owner)
          .matchOrders([order, mirrorOrder], fulfillments, {
            value,
          });
        const receipt = await tx.wait();
        // TODO: check events (need to account for second 1155 token)
        return receipt;
      });
      it("ERC1155 <=> ETH (match, two different groups of 1155's)", async () => {
        // Seller mints first nft
        const { nftId, amount } = await mintAndApprove1155(
          seller,
          marketplaceContract.address
        );

        // Seller mints second nft
        const secondNftId = ethers.BigNumber.from(randomHex().slice(0, 10));
        const secondAmount = ethers.BigNumber.from(randomHex().slice(0, 10));
        await testERC1155Two.mint(seller.address, secondNftId, secondAmount);

        // Seller mints third nft
        const { nftId: thirdNftId, amount: thirdAmount } = await mint1155(
          seller
        );

        // Seller mints fourth nft
        const fourthNftId = ethers.BigNumber.from(randomHex().slice(0, 10));
        const fourthAmount = ethers.BigNumber.from(randomHex().slice(0, 10));
        await testERC1155Two.mint(seller.address, fourthNftId, fourthAmount);

        // Seller approves marketplace contract to transfer NFTs

        await expect(
          testERC1155Two
            .connect(seller)
            .setApprovalForAll(marketplaceContract.address, true)
        )
          .to.emit(testERC1155Two, "ApprovalForAll")
          .withArgs(seller.address, marketplaceContract.address, true);

        const offer = [
          getTestItem1155(nftId, amount, amount, undefined),
          getTestItem1155(
            secondNftId,
            secondAmount,
            secondAmount,
            testERC1155Two.address
          ),
          getTestItem1155(thirdNftId, thirdAmount, thirdAmount),
          getTestItem1155(
            fourthNftId,
            fourthAmount,
            fourthAmount,
            testERC1155Two.address
          ),
        ];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const { mirrorOrder } = await createMirrorBuyNowOrder(
          buyer,
          zone,
          order
        );

        const fulfillments = [
          [[[0, 0]], [[1, 0]]],
          [[[0, 1]], [[1, 1]]],
          [[[0, 2]], [[1, 2]]],
          [[[0, 3]], [[1, 3]]],
          [[[1, 0]], [[0, 0]]],
          [[[1, 0]], [[0, 1]]],
          [[[1, 0]], [[0, 2]]],
        ].map(([offerArr, considerationArr]) =>
          toFulfillment(offerArr, considerationArr)
        );

        const executions = await simulateMatchOrders(
          [order, mirrorOrder],
          fulfillments,
          owner,
          value
        );

        expect(executions.length).to.equal(7);

        const tx = await marketplaceContract
          .connect(owner)
          .matchOrders([order, mirrorOrder], fulfillments, {
            value,
          });
        const receipt = await tx.wait();
        // TODO: check events (need to account for second 1155 token)
        return receipt;
      });
    });

    describe("Fulfill Available Orders", async () => {
      it("Can fulfill a single order via fulfillAvailableOrders", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const offerComponents = [toFulfillmentComponents([[0, 0]])];

        const considerationComponents = [[[0, 0]], [[0, 1]], [[0, 2]]].map(
          toFulfillmentComponents
        );

        await withBalanceChecks([order], 0, null, async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillAvailableOrders(
              [order],
              offerComponents,
              considerationComponents,
              toKey(false),
              100,
              {
                value,
              }
            );
          const receipt = await tx.wait();
          await checkExpectedEvents(receipt, [
            {
              order,
              orderHash,
              fulfiller: buyer.address,
            },
          ]);
          return receipt;
        });
      });
      it("Can fulfill a single order via fulfillAvailableAdvancedOrders", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const offerComponents = [[[0, 0]]];

        const considerationComponents = [[[0, 0]], [[0, 1]], [[0, 2]]];

        await withBalanceChecks([order], 0, null, async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillAvailableAdvancedOrders(
              [order],
              [],
              offerComponents,
              considerationComponents,
              toKey(false),
              100,
              {
                value,
              }
            );
          const receipt = await tx.wait();
          await checkExpectedEvents(receipt, [
            {
              order,
              orderHash,
              fulfiller: buyer.address,
            },
          ]);
          return receipt;
        });
      });
      it("Can fulfill and aggregate multiple orders via fulfillAvailableOrders", async () => {
        // Seller mints nft
        const nftId = ethers.BigNumber.from(randomHex().slice(0, 10));
        const amount = ethers.BigNumber.from(randomHex().slice(0, 10)).mul(2);
        await testERC1155.mint(seller.address, nftId, amount);

        // Seller approves marketplace contract to transfer NFT

        await set1155ApprovalForAll(seller, marketplaceContract.address, true);

        const offer = [getTestItem1155(nftId, amount.div(2), amount.div(2))];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const {
          order: orderOne,
          orderHash: orderHashOne,
          value,
        } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const { order: orderTwo, orderHash: orderHashTwo } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const offerComponents = [
          toFulfillmentComponents([
            [0, 0],
            [1, 0],
          ]),
        ];

        const considerationComponents = [
          [
            [0, 0],
            [1, 0],
          ],
          [
            [0, 1],
            [1, 1],
          ],
          [
            [0, 2],
            [1, 2],
          ],
        ].map(toFulfillmentComponents);

        await whileImpersonating(buyer.address, provider, async () => {
          await withBalanceChecks(
            [orderOne, orderTwo],
            0,
            null,
            async () => {
              const tx = await marketplaceContract
                .connect(buyer)
                .fulfillAvailableOrders(
                  [orderOne, orderTwo],
                  offerComponents,
                  considerationComponents,
                  toKey(false),
                  100,
                  {
                    value: value.mul(2),
                  }
                );
              const receipt = await tx.wait();
              await checkExpectedEvents(
                receipt,
                [
                  {
                    order: orderOne,
                    orderHash: orderHashOne,
                    fulfiller: buyer.address,
                  },
                ],
                [],
                [],
                [],
                false,
                2
              );
              await checkExpectedEvents(
                receipt,
                [
                  {
                    order: orderTwo,
                    orderHash: orderHashTwo,
                    fulfiller: buyer.address,
                  },
                ],
                [],
                [],
                [],
                false,
                2
              );
              return receipt;
            },
            2
          );
        });
      });
      it("Can fulfill and aggregate multiple orders via fulfillAvailableAdvancedOrders", async () => {
        // Seller mints nft
        const nftId = ethers.BigNumber.from(randomHex().slice(0, 10));
        const amount = ethers.BigNumber.from(randomHex().slice(0, 10)).mul(2);
        await testERC1155.mint(seller.address, nftId, amount);

        // Seller approves marketplace contract to transfer NFT

        await set1155ApprovalForAll(seller, marketplaceContract.address, true);

        const offer = [getTestItem1155(nftId, amount.div(2), amount.div(2))];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const {
          order: orderOne,
          orderHash: orderHashOne,
          value,
        } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const { order: orderTwo, orderHash: orderHashTwo } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const offerComponents = [
          toFulfillmentComponents([
            [0, 0],
            [1, 0],
          ]),
        ];

        const considerationComponents = [
          [
            [0, 0],
            [1, 0],
          ],
          [
            [0, 1],
            [1, 1],
          ],
          [
            [0, 2],
            [1, 2],
          ],
        ].map(toFulfillmentComponents);

        await whileImpersonating(buyer.address, provider, async () => {
          await withBalanceChecks(
            [orderOne, orderTwo],
            0,
            null,
            async () => {
              const tx = await marketplaceContract
                .connect(buyer)
                .fulfillAvailableAdvancedOrders(
                  [orderOne, orderTwo],
                  [],
                  offerComponents,
                  considerationComponents,
                  toKey(false),
                  100,
                  {
                    value: value.mul(2),
                  }
                );
              const receipt = await tx.wait();
              await checkExpectedEvents(
                receipt,
                [
                  {
                    order: orderOne,
                    orderHash: orderHashOne,
                    fulfiller: buyer.address,
                  },
                ],
                [],
                [],
                [],
                false,
                2
              );
              await checkExpectedEvents(
                receipt,
                [
                  {
                    order: orderTwo,
                    orderHash: orderHashTwo,
                    fulfiller: buyer.address,
                  },
                ],
                [],
                [],
                [],
                false,
                2
              );
              return receipt;
            },
            2
          );
        });
      });
      it("Can fulfill and aggregate a max number of multiple orders via fulfillAvailableOrders", async () => {
        // Seller mints nft
        const nftId = ethers.BigNumber.from(randomHex().slice(0, 10));
        const amount = ethers.BigNumber.from(randomHex().slice(0, 10)).mul(2);
        await testERC1155.mint(seller.address, nftId, amount);

        // Seller approves marketplace contract to transfer NFT

        await set1155ApprovalForAll(seller, marketplaceContract.address, true);

        const offer = [getTestItem1155(nftId, amount.div(2), amount.div(2))];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const {
          order: orderOne,
          orderHash: orderHashOne,
          value,
        } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const { order: orderTwo } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const offerComponents = [
          [
            [0, 0],
            [1, 0],
          ],
        ];

        const considerationComponents = [
          [
            [0, 0],
            [1, 0],
          ],
          [
            [0, 1],
            [1, 1],
          ],
          [
            [0, 2],
            [1, 2],
          ],
        ];

        await whileImpersonating(buyer.address, provider, async () => {
          await withBalanceChecks(
            [orderOne],
            0,
            null,
            async () => {
              const tx = await marketplaceContract
                .connect(buyer)
                .fulfillAvailableOrders(
                  [orderOne, orderTwo],
                  offerComponents,
                  considerationComponents,
                  toKey(false),
                  1,
                  {
                    value: value.mul(2),
                  }
                );
              const receipt = await tx.wait();
              await checkExpectedEvents(
                receipt,
                [
                  {
                    order: orderOne,
                    orderHash: orderHashOne,
                    fulfiller: buyer.address,
                  },
                ],
                [],
                [],
                [],
                false,
                1
              );
              return receipt;
            },
            1
          );
        });
      });
      it("Can fulfill and aggregate a max number of multiple orders via fulfillAvailableAdvancedOrders", async () => {
        // Seller mints nft
        const nftId = ethers.BigNumber.from(randomHex().slice(0, 10));
        const amount = ethers.BigNumber.from(randomHex().slice(0, 10)).mul(2);
        await testERC1155.mint(seller.address, nftId, amount);

        // Seller approves marketplace contract to transfer NFT

        await set1155ApprovalForAll(seller, marketplaceContract.address, true);

        const offer = [getTestItem1155(nftId, amount.div(2), amount.div(2))];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const {
          order: orderOne,
          orderHash: orderHashOne,
          value,
        } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const { order: orderTwo } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const offerComponents = [
          [
            [0, 0],
            [1, 0],
          ],
        ];

        const considerationComponents = [
          [
            [0, 0],
            [1, 0],
          ],
          [
            [0, 1],
            [1, 1],
          ],
          [
            [0, 2],
            [1, 2],
          ],
        ];

        await whileImpersonating(buyer.address, provider, async () => {
          await withBalanceChecks(
            [orderOne],
            0,
            null,
            async () => {
              const tx = await marketplaceContract
                .connect(buyer)
                .fulfillAvailableAdvancedOrders(
                  [orderOne, orderTwo],
                  [],
                  offerComponents,
                  considerationComponents,
                  toKey(false),
                  1,
                  {
                    value: value.mul(2),
                  }
                );
              const receipt = await tx.wait();
              await checkExpectedEvents(
                receipt,
                [
                  {
                    order: orderOne,
                    orderHash: orderHashOne,
                    fulfiller: buyer.address,
                  },
                ],
                [],
                [],
                [],
                false,
                1
              );
              return receipt;
            },
            1
          );
        });
      });
      it("Can fulfill and aggregate multiple orders via fulfillAvailableOrders with failing orders", async () => {
        // Seller mints nft
        const nftId = ethers.BigNumber.from(randomHex().slice(0, 10));
        const amount = ethers.BigNumber.from(randomHex().slice(0, 10)).mul(2);
        await testERC1155.mint(seller.address, nftId, amount);

        // Seller approves marketplace contract to transfer NFT

        await set1155ApprovalForAll(seller, marketplaceContract.address, true);

        const offer = [getTestItem1155(nftId, amount.div(2), amount.div(2))];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const {
          order: orderOne,
          orderHash: orderHashOne,
          value,
        } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        // second order is expired
        const { order: orderTwo } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0, // FULL_OPEN
          [],
          "EXPIRED"
        );

        // third order will be cancelled
        const {
          order: orderThree,
          orderHash: orderHashThree,
          orderComponents,
        } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        // can cancel it
        await expect(
          marketplaceContract.connect(seller).cancel([orderComponents])
        )
          .to.emit(marketplaceContract, "OrderCancelled")
          .withArgs(orderHashThree, seller.address, zone.address);

        // fourth order will be filled
        const { order: orderFour, orderHash: orderHashFour } =
          await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0 // FULL_OPEN
          );

        // can fill it
        await withBalanceChecks([orderFour], 0, null, async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillOrder(orderFour, toKey(false), {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(receipt, [
            {
              order: orderFour,
              orderHash: orderHashFour,
              fulfiller: buyer.address,
            },
          ]);
          return receipt;
        });

        const offerComponents = [
          [
            [0, 0],
            [1, 0],
            [2, 0],
            [3, 0],
          ],
        ];

        const considerationComponents = [
          [
            [0, 0],
            [1, 0],
            [2, 0],
            [3, 0],
          ],
          [
            [0, 1],
            [1, 1],
            [2, 1],
            [3, 1],
          ],
          [
            [0, 2],
            [1, 2],
            [2, 2],
            [3, 2],
          ],
        ];

        await withBalanceChecks([orderOne], 0, null, async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillAvailableOrders(
              [orderOne, orderTwo, orderThree, orderFour],
              offerComponents,
              considerationComponents,
              toKey(false),
              100,
              {
                value: value.mul(4),
              }
            );
          const receipt = await tx.wait();
          await checkExpectedEvents(receipt, [
            {
              order: orderOne,
              orderHash: orderHashOne,
              fulfiller: buyer.address,
            },
          ]);
          return receipt;
        });
      });
      it("Can fulfill and aggregate multiple orders via fulfillAvailableAdvancedOrders with failing orders", async () => {
        // Seller mints nft
        const nftId = ethers.BigNumber.from(randomHex().slice(0, 10));
        const amount = ethers.BigNumber.from(randomHex().slice(0, 10)).mul(2);
        await testERC1155.mint(seller.address, nftId, amount);

        // Seller approves marketplace contract to transfer NFT

        await set1155ApprovalForAll(seller, marketplaceContract.address, true);

        const offer = [getTestItem1155(nftId, amount.div(2), amount.div(2))];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const {
          order: orderOne,
          orderHash: orderHashOne,
          value,
        } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        // second order is expired
        const { order: orderTwo } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0, // FULL_OPEN
          [],
          "EXPIRED"
        );

        // third order will be cancelled
        const {
          order: orderThree,
          orderHash: orderHashThree,
          orderComponents,
        } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        // can cancel it
        await expect(
          marketplaceContract.connect(seller).cancel([orderComponents])
        )
          .to.emit(marketplaceContract, "OrderCancelled")
          .withArgs(orderHashThree, seller.address, zone.address);

        // fourth order will be filled
        const { order: orderFour, orderHash: orderHashFour } =
          await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0 // FULL_OPEN
          );

        // can fill it
        await withBalanceChecks([orderFour], 0, null, async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillOrder(orderFour, toKey(false), {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(receipt, [
            {
              order: orderFour,
              orderHash: orderHashFour,
              fulfiller: buyer.address,
            },
          ]);
          return receipt;
        });

        const offerComponents = [
          [
            [0, 0],
            [1, 0],
            [2, 0],
            [3, 0],
          ],
        ];

        const considerationComponents = [
          [
            [0, 0],
            [1, 0],
            [2, 0],
            [3, 0],
          ],
          [
            [0, 1],
            [1, 1],
            [2, 1],
            [3, 1],
          ],
          [
            [0, 2],
            [1, 2],
            [2, 2],
            [3, 2],
          ],
        ];

        await withBalanceChecks([orderOne], 0, null, async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillAvailableAdvancedOrders(
              [orderOne, orderTwo, orderThree, orderFour],
              [],
              offerComponents,
              considerationComponents,
              toKey(false),
              100,
              {
                value: value.mul(4),
              }
            );
          const receipt = await tx.wait();
          await checkExpectedEvents(receipt, [
            {
              order: orderOne,
              orderHash: orderHashOne,
              fulfiller: buyer.address,
            },
          ]);
          return receipt;
        });
      });
      it("Can fulfill and aggregate multiple orders via fulfillAvailableAdvancedOrders with failing components including criteria", async () => {
        // Seller mints first nft
        const { nftId, amount } = await mintAndApprove1155(
          seller,
          marketplaceContract.address
        );

        // Seller mints second nft
        const { nftId: secondNftId, amount: secondAmount } = await mint1155(
          seller
        );

        // Seller mints nfts for criteria-based item
        const criteriaNftId = ethers.BigNumber.from(randomHex());
        const secondCriteriaNFTId = ethers.BigNumber.from(randomHex());
        const thirdCriteriaNFTId = ethers.BigNumber.from(randomHex());

        await testERC721.mint(seller.address, criteriaNftId);
        await testERC721.mint(seller.address, secondCriteriaNFTId);
        await testERC721.mint(seller.address, thirdCriteriaNFTId);

        const tokenIds = [
          criteriaNftId,
          secondCriteriaNFTId,
          thirdCriteriaNFTId,
        ];

        // Seller approves marketplace contract to transfer NFTs
        await set721ApprovalForAll(seller, marketplaceContract.address, true);

        const { root, proofs } = merkleTree(tokenIds);

        const offer = [getTestItem1155(nftId, amount, amount, undefined)];

        const offerTwo = [
          {
            itemType: 4, // ERC721WithCriteria
            token: testERC721.address,
            identifierOrCriteria: root,
            startAmount: ethers.BigNumber.from(1),
            endAmount: ethers.BigNumber.from(1),
          },
        ];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const criteriaResolvers = [
          {
            orderIndex: 1,
            side: 0,
            index: 0,
            identifier: criteriaNftId,
            criteriaProof: proofs[criteriaNftId.toString()],
          },
        ];

        const {
          order: orderOne,
          orderHash: orderHashOne,
          value,
        } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        // second order is expired
        const { order: orderTwo } = await createOrder(
          seller,
          zone,
          offerTwo,
          consideration,
          0, // FULL_OPEN
          criteriaResolvers,
          "EXPIRED"
        );

        const offerComponents = [[[0, 0]], [[1, 0]]];

        const considerationComponents = [
          [
            [0, 0],
            [1, 0],
          ],
          [
            [0, 1],
            [1, 1],
          ],
          [
            [0, 2],
            [1, 2],
          ],
        ];

        await withBalanceChecks([orderOne], 0, null, async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillAvailableAdvancedOrders(
              [orderOne, orderTwo],
              criteriaResolvers,
              offerComponents,
              considerationComponents,
              toKey(false),
              100,
              {
                value: value.mul(2),
              }
            );
          const receipt = await tx.wait();
          await checkExpectedEvents(receipt, [
            {
              order: orderOne,
              orderHash: orderHashOne,
              fulfiller: buyer.address,
            },
          ]);
          return receipt;
        });
      });
    });
  });

  describe("Conduit tests", async () => {
    let seller;
    let buyer;
    let sellerContract;
    let buyerContract;

    beforeEach(async () => {
      // Setup basic buyer/seller wallets with ETH
      seller = ethers.Wallet.createRandom().connect(provider);
      buyer = ethers.Wallet.createRandom().connect(provider);
      zone = ethers.Wallet.createRandom().connect(provider);

      sellerContract = await EIP1271WalletFactory.deploy(seller.address);
      buyerContract = await EIP1271WalletFactory.deploy(buyer.address);

      await Promise.all(
        [seller, buyer, zone, sellerContract, buyerContract].map((wallet) =>
          faucet(wallet.address, provider)
        )
      );
    });

    it("Deploys a conduit, adds a channel, and executes transfers", async () => {
      const tempConduitKey =
        "0xff00000000000000000000ff" + owner.address.slice(2);

      const { conduit: tempConduitAddress } =
        await conduitController.getConduit(tempConduitKey);

      await conduitController
        .connect(owner)
        .createConduit(tempConduitKey, owner.address);

      const tempConduit = conduitImplementation.attach(tempConduitAddress);

      await conduitController
        .connect(owner)
        .updateChannel(tempConduit.address, owner.address, true);

      const nftId = ethers.BigNumber.from(randomHex().slice(0, 10));
      const amount = ethers.BigNumber.from(randomHex().slice(0, 10)).add(1);
      await testERC1155.mint(owner.address, nftId, amount.mul(2));

      const secondNftId = ethers.BigNumber.from(randomHex().slice(0, 10));
      const secondAmount = ethers.BigNumber.from(randomHex().slice(0, 10)).add(
        1
      );
      await testERC1155.mint(owner.address, secondNftId, secondAmount.mul(2));

      await set1155ApprovalForAll(owner, tempConduit.address, true);

      await tempConduit.connect(owner).executeWithBatch1155(
        [],
        [
          {
            token: testERC1155.address,
            from: owner.address,
            to: buyer.address,
            ids: [nftId, secondNftId],
            amounts: [amount, secondAmount],
          },
          {
            token: testERC1155.address,
            from: owner.address,
            to: buyer.address,
            ids: [secondNftId, nftId],
            amounts: [secondAmount, amount],
          },
        ]
      );
    });

    it("Reverts on calls to batch transfer 1155 items with no contract on a conduit", async () => {
      const tempConduitKey =
        "0xff00000000000000000000dd" + owner.address.slice(2);

      const { conduit: tempConduitAddress } =
        await conduitController.getConduit(tempConduitKey);

      await conduitController
        .connect(owner)
        .createConduit(tempConduitKey, owner.address);

      const tempConduit = conduitImplementation.attach(tempConduitAddress);

      await conduitController
        .connect(owner)
        .updateChannel(tempConduit.address, owner.address, true);

      const nftId = ethers.BigNumber.from(randomHex().slice(0, 10));
      const amount = ethers.BigNumber.from(randomHex().slice(0, 10)).add(1);
      await testERC1155.mint(owner.address, nftId, amount.mul(2));

      const secondNftId = ethers.BigNumber.from(randomHex().slice(0, 10));
      const secondAmount = ethers.BigNumber.from(randomHex().slice(0, 10)).add(
        1
      );
      await testERC1155.mint(owner.address, secondNftId, secondAmount.mul(2));

      await set1155ApprovalForAll(owner, tempConduit.address, true);

      await expect(
        tempConduit.connect(owner).executeWithBatch1155(
          [],
          [
            {
              token: ethers.constants.AddressZero,
              from: owner.address,
              to: buyer.address,
              ids: [nftId, secondNftId],
              amounts: [amount, secondAmount],
            },
          ]
        )
      ).to.be.revertedWith("NoContract");
    });

    it("Makes batch transfer 1155 items through a conduit", async () => {
      const tempConduitKey =
        "0xff00000000000000000000f1" + owner.address.slice(2);

      const { conduit: tempConduitAddress } =
        await conduitController.getConduit(tempConduitKey);

      await conduitController
        .connect(owner)
        .createConduit(tempConduitKey, owner.address);

      const tempConduit = conduitImplementation.attach(tempConduitAddress);

      await conduitController
        .connect(owner)
        .updateChannel(tempConduit.address, owner.address, true);

      const nftId = 1;
      const amount = ethers.BigNumber.from(randomHex().slice(0, 10)).add(1);
      await testERC1155.mint(owner.address, nftId, amount.mul(2));

      const secondNftId = 2;
      const secondAmount = ethers.BigNumber.from(randomHex().slice(0, 10)).add(
        1
      );
      await testERC1155.mint(owner.address, secondNftId, secondAmount.mul(2));

      const thirdNftId = 3;
      const thirdAmount = ethers.BigNumber.from(randomHex().slice(0, 10)).add(
        1
      );
      await testERC1155.mint(owner.address, thirdNftId, thirdAmount.mul(2));

      const nftId4 = 4;
      const amount4 = ethers.BigNumber.from(randomHex().slice(0, 10)).add(1);
      await testERC1155.mint(owner.address, nftId4, amount4.mul(2));

      const nftId5 = 5;
      const amount5 = ethers.BigNumber.from(randomHex().slice(0, 10)).add(1);
      await testERC1155.mint(owner.address, nftId5, amount5.mul(2));

      const nftId6 = 6;
      const amount6 = ethers.BigNumber.from(randomHex().slice(0, 10)).add(1);
      await testERC1155.mint(owner.address, nftId6, amount6.mul(2));

      const nftId7 = 7;
      const amount7 = ethers.BigNumber.from(randomHex().slice(0, 10)).add(1);
      await testERC1155.mint(owner.address, nftId7, amount7.mul(2));

      const nftId8 = 8;
      const amount8 = ethers.BigNumber.from(randomHex().slice(0, 10)).add(1);
      await testERC1155.mint(owner.address, nftId8, amount8.mul(2));

      const nftId9 = 9;
      const amount9 = ethers.BigNumber.from(randomHex().slice(0, 10)).add(1);
      await testERC1155.mint(owner.address, nftId9, amount9.mul(2));

      const nftId10 = 10;
      const amount10 = ethers.BigNumber.from(randomHex().slice(0, 10)).add(1);
      await testERC1155.mint(owner.address, nftId10, amount10.mul(2));

      await set1155ApprovalForAll(owner, tempConduit.address, true);

      await tempConduit.connect(owner).executeWithBatch1155(
        [],
        [
          {
            token: testERC1155.address,
            from: owner.address,
            to: buyer.address,
            ids: [
              nftId,
              secondNftId,
              thirdNftId,
              nftId4,
              nftId5,
              nftId6,
              nftId7,
              nftId8,
              nftId9,
              nftId10,
            ],
            amounts: [
              amount,
              secondAmount,
              thirdAmount,
              amount4,
              amount5,
              amount6,
              amount7,
              amount8,
              amount9,
              amount10,
            ],
          },
        ]
      );
    });

    it("Performs complex batch transfer through a conduit", async () => {
      const tempConduitKey =
        "0xf100000000000000000000f1" + owner.address.slice(2);

      const { conduit: tempConduitAddress } =
        await conduitController.getConduit(tempConduitKey);

      await conduitController
        .connect(owner)
        .createConduit(tempConduitKey, owner.address);

      const tempConduit = conduitImplementation.attach(tempConduitAddress);

      await conduitController
        .connect(owner)
        .updateChannel(tempConduit.address, owner.address, true);

      const nftId = 1;
      const amount = ethers.BigNumber.from(randomHex().slice(0, 10)).add(1);
      await testERC1155.mint(owner.address, nftId, amount.mul(2));

      const secondNftId = 2;
      const secondAmount = ethers.BigNumber.from(randomHex().slice(0, 10)).add(
        1
      );
      await testERC1155.mint(owner.address, secondNftId, secondAmount.mul(2));

      const thirdNftId = 3;
      const thirdAmount = ethers.BigNumber.from(randomHex().slice(0, 10)).add(
        1
      );
      await testERC1155.mint(owner.address, thirdNftId, thirdAmount.mul(2));

      const nftId4 = 4;
      const amount4 = ethers.BigNumber.from(randomHex().slice(0, 10)).add(1);
      await testERC1155.mint(owner.address, nftId4, amount4.mul(2));

      const nftId5 = 5;
      const amount5 = ethers.BigNumber.from(randomHex().slice(0, 10)).add(1);
      await testERC1155Two.mint(owner.address, nftId5, amount5.mul(2));

      const nftId6 = 6;
      const amount6 = ethers.BigNumber.from(randomHex().slice(0, 10)).add(1);
      await testERC1155Two.mint(owner.address, nftId6, amount6.mul(2));

      const nftId7 = 7;
      const amount7 = ethers.BigNumber.from(randomHex().slice(0, 10)).add(1);
      await testERC1155Two.mint(owner.address, nftId7, amount7.mul(2));

      const nftId8 = 8;
      const amount8 = ethers.BigNumber.from(randomHex().slice(0, 10)).add(1);
      await testERC1155Two.mint(owner.address, nftId8, amount8.mul(2));

      const amount9 = ethers.BigNumber.from(randomHex().slice(0, 10)).add(1);
      await mintAndApproveERC20(owner, tempConduit.address, amount9.mul(2));

      const nftId10 = 10;
      await testERC721.mint(owner.address, nftId10);

      await set1155ApprovalForAll(owner, tempConduit.address, true);

      await expect(
        testERC1155Two
          .connect(owner)
          .setApprovalForAll(tempConduit.address, true)
      )
        .to.emit(testERC1155Two, "ApprovalForAll")
        .withArgs(owner.address, tempConduit.address, true);

      await set721ApprovalForAll(owner, tempConduit.address, true);

      const newAddress = toAddress(12345);

      await tempConduit.connect(owner).executeWithBatch1155(
        [
          {
            itemType: 1,
            token: testERC20.address,
            from: owner.address,
            to: newAddress,
            identifier: ethers.BigNumber.from(0),
            amount: amount9,
          },
          {
            itemType: 2,
            token: testERC721.address,
            from: owner.address,
            to: newAddress,
            identifier: nftId10,
            amount: ethers.BigNumber.from(1),
          },
        ],
        [
          {
            token: testERC1155.address,
            from: owner.address,
            to: newAddress,
            ids: [nftId, secondNftId, thirdNftId, nftId4],
            amounts: [amount, secondAmount, thirdAmount, amount4],
          },
          {
            token: testERC1155Two.address,
            from: owner.address,
            to: newAddress,
            ids: [nftId5, nftId6, nftId7, nftId8],
            amounts: [amount5, amount6, amount7, amount8],
          },
        ]
      );

      expect(await testERC1155.balanceOf(newAddress, nftId)).to.equal(amount);
      expect(await testERC1155.balanceOf(newAddress, secondNftId)).to.equal(
        secondAmount
      );
      expect(await testERC1155.balanceOf(newAddress, thirdNftId)).to.equal(
        thirdAmount
      );
      expect(await testERC1155.balanceOf(newAddress, nftId4)).to.equal(amount4);

      expect(await testERC1155Two.balanceOf(newAddress, nftId5)).to.equal(
        amount5
      );
      expect(await testERC1155Two.balanceOf(newAddress, nftId6)).to.equal(
        amount6
      );
      expect(await testERC1155Two.balanceOf(newAddress, nftId7)).to.equal(
        amount7
      );
      expect(await testERC1155Two.balanceOf(newAddress, nftId8)).to.equal(
        amount8
      );

      expect(await testERC20.balanceOf(newAddress)).to.equal(amount9);
      expect(await testERC721.ownerOf(nftId10)).to.equal(newAddress);
    });

    it("ERC1155 <=> ETH (match, two different groups of 1155's)", async () => {
      // Seller mints first nft
      const nftId = ethers.BigNumber.from(randomHex().slice(0, 10));
      const amount = ethers.BigNumber.from(randomHex().slice(0, 10));
      await testERC1155.mint(seller.address, nftId, amount);

      // Seller mints second nft
      const secondNftId = ethers.BigNumber.from(randomHex().slice(0, 10));
      const secondAmount = ethers.BigNumber.from(randomHex().slice(0, 10));
      await testERC1155Two.mint(seller.address, secondNftId, secondAmount);

      // Seller mints third nft
      const thirdNftId = ethers.BigNumber.from(randomHex().slice(0, 10));
      const thirdAmount = ethers.BigNumber.from(randomHex().slice(0, 10));
      await testERC1155.mint(seller.address, thirdNftId, thirdAmount);

      // Seller mints fourth nft
      const fourthNftId = ethers.BigNumber.from(randomHex().slice(0, 10));
      const fourthAmount = ethers.BigNumber.from(randomHex().slice(0, 10));
      await testERC1155Two.mint(seller.address, fourthNftId, fourthAmount);

      // Seller approves marketplace contract to transfer NFTs
      await set1155ApprovalForAll(seller, marketplaceContract.address, true);

      await expect(
        testERC1155Two
          .connect(seller)
          .setApprovalForAll(marketplaceContract.address, true)
      )
        .to.emit(testERC1155Two, "ApprovalForAll")
        .withArgs(seller.address, marketplaceContract.address, true);

      const offer = [
        getTestItem1155(nftId, amount, amount),
        getTestItem1155(
          secondNftId,
          secondAmount,
          secondAmount,
          testERC1155Two.address
        ),
        getTestItem1155(thirdNftId, thirdAmount, thirdAmount),
        getTestItem1155(
          fourthNftId,
          fourthAmount,
          fourthAmount,
          testERC1155Two.address
        ),
      ];

      const consideration = [
        getItemETH(10, 10, seller.address),
        getItemETH(1, 1, zone.address),
        getItemETH(1, 1, owner.address),
      ];

      const { order, value } = await createOrder(
        seller,
        zone,
        offer,
        consideration,
        0 // FULL_OPEN
      );

      const { mirrorOrder } = await createMirrorBuyNowOrder(buyer, zone, order);

      const fulfillments = [
        [[[0, 0]], [[1, 0]]],
        [[[0, 1]], [[1, 1]]],
        [[[0, 2]], [[1, 2]]],
        [[[0, 3]], [[1, 3]]],
        [[[1, 0]], [[0, 0]]],
        [[[1, 0]], [[0, 1]]],
        [[[1, 0]], [[0, 2]]],
      ].map(([offerArr, considerationArr]) =>
        toFulfillment(offerArr, considerationArr)
      );

      const executions = await simulateMatchOrders(
        [order, mirrorOrder],
        fulfillments,
        owner,
        value
      );

      expect(executions.length).to.equal(7);

      await marketplaceContract
        .connect(owner)
        .matchOrders([order, mirrorOrder], fulfillments, {
          value,
        });
    });

    it("Reverts when attempting to update a conduit channel when call is not from controller", async () => {
      await expect(
        conduitOne.connect(owner).updateChannel(constants.AddressZero, true)
      ).to.be.revertedWith("InvalidController");
    });

    it("Reverts when attempting to execute transfers on a conduit when not called from a channel", async () => {
      await expect(conduitOne.connect(owner).execute([])).to.be.revertedWith(
        "ChannelClosed"
      );
    });

    it("Reverts when attempting to execute with 1155 transfers on a conduit when not called from a channel", async () => {
      await expect(
        conduitOne.connect(owner).executeWithBatch1155([], [])
      ).to.be.revertedWith("ChannelClosed");
    });

    it("Retrieves the owner of a conduit", async () => {
      const ownerOf = await conduitController.ownerOf(conduitOne.address);
      expect(ownerOf).to.equal(owner.address);

      await expect(
        conduitController.connect(owner).ownerOf(buyer.address)
      ).to.be.revertedWith("NoConduit");
    });

    it("Retrieves the key of a conduit", async () => {
      const key = await conduitController.getKey(conduitOne.address);
      expect(key.toLowerCase()).to.equal(conduitKeyOne.toLowerCase());

      await expect(
        conduitController.connect(owner).getKey(buyer.address)
      ).to.be.revertedWith("NoConduit");
    });

    it("Retrieves the status of a conduit channel", async () => {
      let isOpen = await conduitController.getChannelStatus(
        conduitOne.address,
        marketplaceContract.address
      );
      expect(isOpen).to.be.true;

      isOpen = await conduitController.getChannelStatus(
        conduitOne.address,
        seller.address
      );
      expect(isOpen).to.be.false;

      await expect(
        conduitController
          .connect(owner)
          .getChannelStatus(buyer.address, seller.address)
      ).to.be.revertedWith("NoConduit");
    });

    it("Retrieves conduit channels from the controller", async () => {
      const totalChannels = await conduitController.getTotalChannels(
        conduitOne.address
      );
      expect(totalChannels).to.equal(1);

      await expect(
        conduitController.connect(owner).getTotalChannels(buyer.address)
      ).to.be.revertedWith("NoConduit");

      const firstChannel = await conduitController.getChannel(
        conduitOne.address,
        0
      );
      expect(firstChannel).to.equal(marketplaceContract.address);

      await expect(
        conduitController
          .connect(owner)
          .getChannel(buyer.address, totalChannels - 1)
      ).to.be.revertedWith("NoConduit");

      await expect(
        conduitController.connect(owner).getChannel(conduitOne.address, 1)
      ).to.be.revertedWith("ChannelOutOfRange", conduitOne.address);

      await expect(
        conduitController.connect(owner).getChannel(conduitOne.address, 2)
      ).to.be.revertedWith("ChannelOutOfRange", conduitOne.address);

      const channels = await conduitController.getChannels(conduitOne.address);
      expect(channels.length).to.equal(1);
      expect(channels[0]).to.equal(marketplaceContract.address);

      await expect(
        conduitController.connect(owner).getChannels(buyer.address)
      ).to.be.revertedWith("NoConduit");
    });

    it("Adds and removes channels", async () => {
      // Get number of open channels
      let totalChannels = await conduitController.getTotalChannels(
        conduitOne.address
      );
      expect(totalChannels).to.equal(1);

      let isOpen = await conduitController.getChannelStatus(
        conduitOne.address,
        marketplaceContract.address
      );
      expect(isOpen).to.be.true;

      // No-op
      await conduitController
        .connect(owner)
        .updateChannel(conduitOne.address, marketplaceContract.address, true);

      isOpen = await conduitController.getChannelStatus(
        conduitOne.address,
        marketplaceContract.address
      );
      expect(isOpen).to.be.true;

      // Get number of open channels
      totalChannels = await conduitController.getTotalChannels(
        conduitOne.address
      );
      expect(totalChannels).to.equal(1);

      await conduitController
        .connect(owner)
        .updateChannel(conduitOne.address, seller.address, true);

      isOpen = await conduitController.getChannelStatus(
        conduitOne.address,
        seller.address
      );
      expect(isOpen).to.be.true;

      // Get number of open channels
      totalChannels = await conduitController.getTotalChannels(
        conduitOne.address
      );
      expect(totalChannels).to.equal(2);

      await conduitController
        .connect(owner)
        .updateChannel(conduitOne.address, marketplaceContract.address, false);

      isOpen = await conduitController.getChannelStatus(
        conduitOne.address,
        marketplaceContract.address
      );
      expect(isOpen).to.be.false;

      // Get number of open channels
      totalChannels = await conduitController.getTotalChannels(
        conduitOne.address
      );
      expect(totalChannels).to.equal(1);

      await conduitController
        .connect(owner)
        .updateChannel(conduitOne.address, seller.address, false);

      isOpen = await conduitController.getChannelStatus(
        conduitOne.address,
        seller.address
      );
      expect(isOpen).to.be.false;

      // Get number of open channels
      totalChannels = await conduitController.getTotalChannels(
        conduitOne.address
      );
      expect(totalChannels).to.equal(0);

      await conduitController
        .connect(owner)
        .updateChannel(conduitOne.address, marketplaceContract.address, true);

      isOpen = await conduitController.getChannelStatus(
        conduitOne.address,
        marketplaceContract.address
      );
      expect(isOpen).to.be.true;

      // Get number of open channels
      totalChannels = await conduitController.getTotalChannels(
        conduitOne.address
      );
      expect(totalChannels).to.equal(1);
    });

    it("Reverts on an attempt to move an unsupported item", async () => {
      await conduitController
        .connect(owner)
        .updateChannel(conduitOne.address, seller.address, true);

      const isOpen = await conduitController.getChannelStatus(
        conduitOne.address,
        seller.address
      );
      expect(isOpen).to.be.true;

      await expect(
        conduitOne.connect(seller).executeWithBatch1155(
          [
            {
              itemType: 1, // ERC20
              token: testERC20.address,
              from: buyer.address,
              to: seller.address,
              identifier: 0,
              amount: 0,
            },
            {
              itemType: 0, // NATIVE (invalid)
              token: ethers.constants.AddressZero,
              from: conduitOne.address,
              to: seller.address,
              identifier: 0,
              amount: 1,
            },
          ],
          []
        )
      ).to.be.revertedWith("InvalidItemType");
    });

    it("Reverts when attempting to create a conduit not scoped to the creator", async () => {
      await expect(
        conduitController
          .connect(owner)
          .createConduit(ethers.constants.HashZero, owner.address)
      ).to.be.revertedWith("InvalidCreator");
    });

    it("Reverts when attempting to create a conduit that already exists", async () => {
      await expect(
        conduitController
          .connect(owner)
          .createConduit(conduitKeyOne, owner.address)
      ).to.be.revertedWith(`ConduitAlreadyExists("${conduitOne.address}")`);
    });

    it("Reverts when attempting to update a channel for an unowned conduit", async () => {
      await expect(
        conduitController
          .connect(buyer)
          .updateChannel(conduitOne.address, buyer.address, true)
      ).to.be.revertedWith(`CallerIsNotOwner("${conduitOne.address}")`);
    });

    it("Retrieves no initial potential owner for new conduit", async () => {
      const potentialOwner = await conduitController.getPotentialOwner(
        conduitOne.address
      );
      expect(potentialOwner).to.equal(ethers.constants.AddressZero);

      await expect(
        conduitController.connect(owner).getPotentialOwner(buyer.address)
      ).to.be.revertedWith("NoConduit");
    });

    it("Lets the owner transfer ownership via a two-stage process", async () => {
      await expect(
        conduitController
          .connect(buyer)
          .transferOwnership(conduitOne.address, buyer.address)
      ).to.be.revertedWith("CallerIsNotOwner", conduitOne.address);

      await expect(
        conduitController
          .connect(owner)
          .transferOwnership(conduitOne.address, ethers.constants.AddressZero)
      ).to.be.revertedWith(
        "NewPotentialOwnerIsZeroAddress",
        conduitOne.address
      );

      await expect(
        conduitController
          .connect(owner)
          .transferOwnership(seller.address, buyer.address)
      ).to.be.revertedWith("NoConduit");

      let potentialOwner = await conduitController.getPotentialOwner(
        conduitOne.address
      );
      expect(potentialOwner).to.equal(ethers.constants.AddressZero);

      await conduitController.transferOwnership(
        conduitOne.address,
        buyer.address
      );

      potentialOwner = await conduitController.getPotentialOwner(
        conduitOne.address
      );
      expect(potentialOwner).to.equal(buyer.address);

      await expect(
        conduitController
          .connect(buyer)
          .cancelOwnershipTransfer(conduitOne.address)
      ).to.be.revertedWith("CallerIsNotOwner", conduitOne.address);

      await expect(
        conduitController.connect(owner).cancelOwnershipTransfer(seller.address)
      ).to.be.revertedWith("NoConduit");

      await conduitController.cancelOwnershipTransfer(conduitOne.address);

      potentialOwner = await conduitController.getPotentialOwner(
        conduitOne.address
      );
      expect(potentialOwner).to.equal(ethers.constants.AddressZero);

      await conduitController.transferOwnership(
        conduitOne.address,
        buyer.address
      );

      potentialOwner = await conduitController.getPotentialOwner(
        conduitOne.address
      );
      expect(potentialOwner).to.equal(buyer.address);

      await expect(
        conduitController.connect(buyer).acceptOwnership(seller.address)
      ).to.be.revertedWith("NoConduit");

      await expect(
        conduitController.connect(seller).acceptOwnership(conduitOne.address)
      ).to.be.revertedWith("CallerIsNotNewPotentialOwner", conduitOne.address);

      await conduitController
        .connect(buyer)
        .acceptOwnership(conduitOne.address);

      potentialOwner = await conduitController.getPotentialOwner(
        conduitOne.address
      );
      expect(potentialOwner).to.equal(ethers.constants.AddressZero);

      const ownerOf = await conduitController.ownerOf(conduitOne.address);
      expect(ownerOf).to.equal(buyer.address);
    });
  });

  describe("Reverts", async () => {
    let seller;
    let buyer;
    let sellerContract;
    let buyerContract;

    beforeEach(async () => {
      // Setup basic buyer/seller wallets with ETH
      seller = ethers.Wallet.createRandom().connect(provider);
      buyer = ethers.Wallet.createRandom().connect(provider);
      zone = ethers.Wallet.createRandom().connect(provider);

      sellerContract = await EIP1271WalletFactory.deploy(seller.address);
      buyerContract = await EIP1271WalletFactory.deploy(buyer.address);

      await Promise.all(
        [seller, buyer, zone, sellerContract, buyerContract].map((wallet) =>
          faucet(wallet.address, provider)
        )
      );
    });

    describe("Misconfigured orders", async () => {
      it("Reverts on bad fraction amounts", async () => {
        // Seller mints nft
        const { nftId, amount } = await mintAndApprove1155(
          seller,
          marketplaceContract.address,
          10000
        );

        const offer = [getTestItem1155(nftId, amount.mul(10), amount.mul(10))];

        const consideration = [
          {
            itemType: 0, // ETH
            token: constants.AddressZero,
            identifierOrCriteria: 0, // ignored for ETH
            startAmount: amount.mul(1000),
            endAmount: amount.mul(1000),
            recipient: seller.address,
          },
          {
            itemType: 0, // ETH
            token: constants.AddressZero,
            identifierOrCriteria: 0, // ignored for ETH
            startAmount: amount.mul(10),
            endAmount: amount.mul(10),
            recipient: zone.address,
          },
          {
            itemType: 0, // ETH
            token: constants.AddressZero,
            identifierOrCriteria: 0, // ignored for ETH
            startAmount: amount.mul(20),
            endAmount: amount.mul(20),
            recipient: owner.address,
          },
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          1 // PARTIAL_OPEN
        );

        let orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(false);
        expect(orderStatus.totalFilled).to.equal(0);
        expect(orderStatus.totalSize).to.equal(0);

        order.numerator = 0;
        order.denominator = 10;

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value,
            })
        ).to.be.revertedWith("BadFraction");

        orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(false);
        expect(orderStatus.totalFilled).to.equal(0);
        expect(orderStatus.totalSize).to.equal(0);

        order.numerator = 1;
        order.denominator = 0;

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value,
            })
        ).to.be.revertedWith("BadFraction");

        orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(false);
        expect(orderStatus.totalFilled).to.equal(0);
        expect(orderStatus.totalSize).to.equal(0);

        order.numerator = 2;
        order.denominator = 1;

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value,
            })
        ).to.be.revertedWith("BadFraction");

        orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(false);
        expect(orderStatus.totalFilled).to.equal(0);
        expect(orderStatus.totalSize).to.equal(0);

        order.numerator = 1;
        order.denominator = 2;

        await withBalanceChecks([order], 0, [], async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ],
            null,
            []
          );
          return receipt;
        });

        orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(true);
        expect(orderStatus.totalFilled).to.equal(1);
        expect(orderStatus.totalSize).to.equal(2);
      });
      it("Reverts on inexact fraction amounts", async () => {
        // Seller mints nft
        const { nftId, amount } = await mintAndApprove1155(
          seller,
          marketplaceContract.address,
          10000
        );

        const offer = [getTestItem1155(nftId, amount.mul(10), amount.mul(10))];

        const consideration = [
          {
            itemType: 0, // ETH
            token: constants.AddressZero,
            identifierOrCriteria: 0, // ignored for ETH
            startAmount: amount.mul(1000),
            endAmount: amount.mul(1000),
            recipient: seller.address,
          },
          {
            itemType: 0, // ETH
            token: constants.AddressZero,
            identifierOrCriteria: 0, // ignored for ETH
            startAmount: amount.mul(10),
            endAmount: amount.mul(10),
            recipient: zone.address,
          },
          {
            itemType: 0, // ETH
            token: constants.AddressZero,
            identifierOrCriteria: 0, // ignored for ETH
            startAmount: amount.mul(20),
            endAmount: amount.mul(20),
            recipient: owner.address,
          },
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          1 // PARTIAL_OPEN
        );

        let orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(false);
        expect(orderStatus.totalFilled).to.equal(0);
        expect(orderStatus.totalSize).to.equal(0);

        order.numerator = 1;
        order.denominator = 8191;

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value,
            })
        ).to.be.revertedWith("InexactFraction");

        orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(false);
        expect(orderStatus.totalFilled).to.equal(0);
        expect(orderStatus.totalSize).to.equal(0);

        order.numerator = 1;
        order.denominator = 2;

        await withBalanceChecks([order], 0, [], async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ],
            null,
            []
          );
          return receipt;
        });

        orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(true);
        expect(orderStatus.totalFilled).to.equal(1);
        expect(orderStatus.totalSize).to.equal(2);
      });
      it("Reverts on partial fill attempt when not supported by order", async () => {
        // Seller mints nft
        const { nftId, amount } = await mintAndApprove1155(
          seller,
          marketplaceContract.address,
          10000
        );

        const offer = [getTestItem1155(nftId, amount.mul(10), amount.mul(10))];

        const consideration = [
          {
            itemType: 0, // ETH
            token: constants.AddressZero,
            identifierOrCriteria: 0, // ignored for ETH
            startAmount: amount.mul(1000),
            endAmount: amount.mul(1000),
            recipient: seller.address,
          },
          {
            itemType: 0, // ETH
            token: constants.AddressZero,
            identifierOrCriteria: 0, // ignored for ETH
            startAmount: amount.mul(10),
            endAmount: amount.mul(10),
            recipient: zone.address,
          },
          {
            itemType: 0, // ETH
            token: constants.AddressZero,
            identifierOrCriteria: 0, // ignored for ETH
            startAmount: amount.mul(20),
            endAmount: amount.mul(20),
            recipient: owner.address,
          },
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        let orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(false);
        expect(orderStatus.totalFilled).to.equal(0);
        expect(orderStatus.totalSize).to.equal(0);

        order.numerator = 1;
        order.denominator = 2;

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value,
            })
        ).to.be.revertedWith("PartialFillsNotEnabledForOrder");

        orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(false);
        expect(orderStatus.totalFilled).to.equal(0);
        expect(orderStatus.totalSize).to.equal(0);

        order.numerator = 1;
        order.denominator = 1;

        await withBalanceChecks([order], 0, [], async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ],
            null,
            []
          );
          return receipt;
        });

        orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(true);
        expect(orderStatus.totalFilled).to.equal(1);
        expect(orderStatus.totalSize).to.equal(1);
      });
      it("Reverts on partially filled order via basic fulfillment", async () => {
        // Seller mints nft
        const { nftId, amount } = await mintAndApprove1155(
          seller,
          marketplaceContract.address,
          10000
        );

        const offer = [getTestItem1155(nftId, amount.mul(10), amount.mul(10))];

        const consideration = [
          {
            itemType: 0, // ETH
            token: constants.AddressZero,
            identifierOrCriteria: 0, // ignored for ETH
            startAmount: amount.mul(1000),
            endAmount: amount.mul(1000),
            recipient: seller.address,
          },
          {
            itemType: 0, // ETH
            token: constants.AddressZero,
            identifierOrCriteria: 0, // ignored for ETH
            startAmount: amount.mul(10),
            endAmount: amount.mul(10),
            recipient: zone.address,
          },
          {
            itemType: 0, // ETH
            token: constants.AddressZero,
            identifierOrCriteria: 0, // ignored for ETH
            startAmount: amount.mul(20),
            endAmount: amount.mul(20),
            recipient: owner.address,
          },
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          1 // PARTIAL_OPEN
        );

        let orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(false);
        expect(orderStatus.totalFilled).to.equal(0);
        expect(orderStatus.totalSize).to.equal(0);

        order.numerator = 1;
        order.denominator = 2;

        await withBalanceChecks([order], 0, [], async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ],
            null,
            []
          );
          return receipt;
        });

        orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(true);
        expect(orderStatus.totalFilled).to.equal(1);
        expect(orderStatus.totalSize).to.equal(2);

        const basicOrderParameters = getBasicOrderParameters(
          1, // EthForERC1155
          order
        );

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillBasicOrder(basicOrderParameters, {
              value,
            })
        ).to.be.revertedWith(`OrderPartiallyFilled("${orderHash}")`);
      });
      it("Reverts on fully filled order", async () => {
        // Seller mints nft
        const { nftId, amount } = await mintAndApprove1155(
          seller,
          marketplaceContract.address,
          10000
        );

        const offer = [getTestItem1155(nftId, amount.mul(10), amount.mul(10))];

        const consideration = [
          {
            itemType: 0, // ETH
            token: constants.AddressZero,
            identifierOrCriteria: 0, // ignored for ETH
            startAmount: amount.mul(1000),
            endAmount: amount.mul(1000),
            recipient: seller.address,
          },
          {
            itemType: 0, // ETH
            token: constants.AddressZero,
            identifierOrCriteria: 0, // ignored for ETH
            startAmount: amount.mul(10),
            endAmount: amount.mul(10),
            recipient: zone.address,
          },
          {
            itemType: 0, // ETH
            token: constants.AddressZero,
            identifierOrCriteria: 0, // ignored for ETH
            startAmount: amount.mul(20),
            endAmount: amount.mul(20),
            recipient: owner.address,
          },
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          1 // PARTIAL_OPEN
        );

        let orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(false);
        expect(orderStatus.totalFilled).to.equal(0);
        expect(orderStatus.totalSize).to.equal(0);

        order.numerator = 1;
        order.denominator = 1;

        await withBalanceChecks([order], 0, [], async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ],
            null,
            []
          );
          return receipt;
        });

        orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(true);
        expect(orderStatus.totalFilled).to.equal(1);
        expect(orderStatus.totalSize).to.equal(1);

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value,
            })
        ).to.be.revertedWith(`OrderAlreadyFilled("${orderHash}")`);
      });
      it("Reverts on inadequate consideration items", async () => {
        // Seller mints nft
        const { nftId, amount } = await mintAndApprove1155(
          seller,
          marketplaceContract.address,
          10000
        );

        const offer = [getTestItem1155(nftId, amount.mul(10), amount.mul(10))];

        const consideration = [
          {
            itemType: 0, // ETH
            token: constants.AddressZero,
            identifierOrCriteria: 0, // ignored for ETH
            startAmount: amount.mul(1000),
            endAmount: amount.mul(1000),
            recipient: seller.address,
          },
          {
            itemType: 0, // ETH
            token: constants.AddressZero,
            identifierOrCriteria: 0, // ignored for ETH
            startAmount: amount.mul(10),
            endAmount: amount.mul(10),
            recipient: zone.address,
          },
          {
            itemType: 0, // ETH
            token: constants.AddressZero,
            identifierOrCriteria: 0, // ignored for ETH
            startAmount: amount.mul(20),
            endAmount: amount.mul(20),
            recipient: owner.address,
          },
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          1 // PARTIAL_OPEN
        );

        // Remove a consideration item, but do not reduce
        // totalOriginalConsiderationItems as MissingOriginalConsiderationItems
        // is being tested for
        order.parameters.consideration.pop();

        const orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(false);
        expect(orderStatus.totalFilled).to.equal(0);
        expect(orderStatus.totalSize).to.equal(0);

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value,
            })
        ).to.be.revertedWith("MissingOriginalConsiderationItems");
      });
      it("Reverts on invalid submitter when required by order", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          2 // FULL_RESTRICTED
        );

        const { mirrorOrder, mirrorOrderHash } = await createMirrorBuyNowOrder(
          buyer,
          zone,
          order
        );

        const fulfillments = defaultBuyNowMirrorFulfillment;

        const executions = await simulateMatchOrders(
          [order, mirrorOrder],
          fulfillments,
          zone,
          value
        );

        expect(executions.length).to.equal(4);

        if (!process.env.REFERENCE) {
          await expect(
            marketplaceContract
              .connect(owner)
              .matchOrders([order, mirrorOrder], fulfillments, {
                value,
              })
          ).to.be.revertedWith(`InvalidRestrictedOrder("${orderHash}")`);
        } else {
          await expect(
            marketplaceContract
              .connect(owner)
              .matchOrders([order, mirrorOrder], fulfillments, {
                value,
              })
          ).to.be.reverted;
        }

        const tx = await marketplaceContract
          .connect(zone)
          .matchOrders([order, mirrorOrder], fulfillments, {
            value,
          });
        const receipt = await tx.wait();
        await checkExpectedEvents(
          receipt,
          [
            {
              order,
              orderHash,
              fulfiller: constants.AddressZero,
            },
          ],
          executions
        );
        await checkExpectedEvents(
          receipt,
          [
            {
              order: mirrorOrder,
              orderHash: mirrorOrderHash,
              fulfiller: constants.AddressZero,
            },
          ],
          executions
        );
        return receipt;
      });
      it("Reverts on invalid signatures", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const originalSignature = order.signature;

        // set an invalid V value
        order.signature = order.signature.slice(0, -2) + "01";

        const basicOrderParameters = getBasicOrderParameters(
          0, // EthForERC721
          order
        );

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillBasicOrder(basicOrderParameters, {
              value,
            })
        ).to.be.revertedWith("BadSignatureV(1)");

        // construct an invalid signature
        basicOrderParameters.signature = "0x".padEnd(130, "f") + "1c";

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillBasicOrder(basicOrderParameters, {
              value,
            })
        ).to.be.revertedWith("InvalidSignature");

        basicOrderParameters.signature = originalSignature;

        await withBalanceChecks([order], 0, null, async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillBasicOrder(basicOrderParameters, {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(receipt, [
            {
              order,
              orderHash,
              fulfiller: buyer.address,
            },
          ]);
          return receipt;
        });
      });
      it("Reverts on invalid 1271 signature", async () => {
        // Seller mints nft to contract
        const nftId = ethers.BigNumber.from(randomHex());
        await testERC721.mint(sellerContract.address, nftId);

        // Seller approves marketplace contract to transfer NFT
        await expect(
          sellerContract
            .connect(seller)
            .approveNFT(testERC721.address, marketplaceContract.address)
        )
          .to.emit(testERC721, "ApprovalForAll")
          .withArgs(sellerContract.address, marketplaceContract.address, true);

        // Buyer mints ERC20
        const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);
        await testERC20.mint(buyer.address, tokenAmount);

        // Buyer approves marketplace contract to transfer tokens
        await expect(
          testERC20
            .connect(buyer)
            .approve(marketplaceContract.address, tokenAmount)
        )
          .to.emit(testERC20, "Approval")
          .withArgs(buyer.address, marketplaceContract.address, tokenAmount);

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getTestItem20(
            tokenAmount.sub(100),
            tokenAmount.sub(100),
            sellerContract.address
          ),
          getTestItem20(40, 40, zone.address),
          getTestItem20(40, 40, owner.address),
        ];

        const { order } = await createOrder(
          sellerContract,
          zone,
          offer,
          consideration,
          0, // FULL_OPEN
          [],
          null,
          zone // wrong signer
        );

        const basicOrderParameters = getBasicOrderParameters(
          2, // ERC20ForERC721
          order
        );

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillBasicOrder(basicOrderParameters)
        ).to.be.revertedWith("BAD SIGNER");
      });
      it("Reverts on invalid contract 1271 signature and contract does not supply a revert reason", async () => {
        await sellerContract.connect(owner).revertWithMessage(false);

        // Seller mints nft to contract
        const nftId = ethers.BigNumber.from(randomHex());
        await testERC721.mint(sellerContract.address, nftId);

        // Seller approves marketplace contract to transfer NFT
        await expect(
          sellerContract
            .connect(seller)
            .approveNFT(testERC721.address, marketplaceContract.address)
        )
          .to.emit(testERC721, "ApprovalForAll")
          .withArgs(sellerContract.address, marketplaceContract.address, true);

        // Buyer mints ERC20
        const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);
        await testERC20.mint(buyer.address, tokenAmount);

        // Buyer approves marketplace contract to transfer tokens
        await expect(
          testERC20
            .connect(buyer)
            .approve(marketplaceContract.address, tokenAmount)
        )
          .to.emit(testERC20, "Approval")
          .withArgs(buyer.address, marketplaceContract.address, tokenAmount);

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getTestItem20(
            tokenAmount.sub(100),
            tokenAmount.sub(100),
            sellerContract.address
          ),
          getTestItem20(50, 50, zone.address),
          getTestItem20(50, 50, owner.address),
        ];

        const { order } = await createOrder(
          sellerContract,
          zone,
          offer,
          consideration,
          0, // FULL_OPEN
          [],
          null,
          zone // wrong signer
        );

        const basicOrderParameters = getBasicOrderParameters(
          2, // ERC20ForERC721
          order
        );

        if (!process.env.REFERENCE) {
          await expect(
            marketplaceContract
              .connect(buyer)
              .fulfillBasicOrder(basicOrderParameters)
          ).to.be.revertedWith("BadContractSignature");
        } else {
          await expect(
            marketplaceContract
              .connect(buyer)
              .fulfillBasicOrder(basicOrderParameters)
          ).to.be.reverted;
        }
      });
      it("Reverts on invalid contract 1271 signature and contract does not return magic value", async () => {
        await sellerContract.connect(owner).setValid(false);

        // Seller mints nft to contract
        const nftId = ethers.BigNumber.from(randomHex());
        await testERC721.mint(sellerContract.address, nftId);

        // Seller approves marketplace contract to transfer NFT
        await expect(
          sellerContract
            .connect(seller)
            .approveNFT(testERC721.address, marketplaceContract.address)
        )
          .to.emit(testERC721, "ApprovalForAll")
          .withArgs(sellerContract.address, marketplaceContract.address, true);

        // Buyer mints ERC20
        const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);
        await testERC20.mint(buyer.address, tokenAmount);

        // Buyer approves marketplace contract to transfer tokens
        await expect(
          testERC20
            .connect(buyer)
            .approve(marketplaceContract.address, tokenAmount)
        )
          .to.emit(testERC20, "Approval")
          .withArgs(buyer.address, marketplaceContract.address, tokenAmount);

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getTestItem20(
            tokenAmount.sub(100),
            tokenAmount.sub(100),
            sellerContract.address
          ),
          getTestItem20(50, 50, zone.address),
          getTestItem20(50, 50, owner.address),
        ];

        const { order } = await createOrder(
          sellerContract,
          zone,
          offer,
          consideration,
          0, // FULL_OPEN
          [],
          null,
          seller
        );

        const basicOrderParameters = getBasicOrderParameters(
          2, // ERC20ForERC721
          order
        );

        if (!process.env.REFERENCE) {
          await expect(
            marketplaceContract
              .connect(buyer)
              .fulfillBasicOrder(basicOrderParameters)
          ).to.be.revertedWith("InvalidSigner");
        } else {
          await expect(
            marketplaceContract
              .connect(buyer)
              .fulfillBasicOrder(basicOrderParameters)
          ).to.be.reverted;
        }

        await sellerContract.connect(owner).setValid(true);
      });
      it("Reverts on restricted order where isValidOrder reverts with no data", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          stubZone,
          offer,
          consideration,
          2, // FULL_RESTRICTED,
          [],
          null,
          seller,
          "0x".padEnd(65, "0") + "2"
        );

        if (!process.env.REFERENCE) {
          await expect(
            marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, toKey(false), {
                value,
              })
          ).to.be.revertedWith(`InvalidRestrictedOrder("${orderHash}")`);
        } else {
          await expect(
            marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, toKey(false), {
                value,
              })
          ).to.be.reverted;
        }

        order.extraData = "0x0102030405";

        if (!process.env.REFERENCE) {
          await expect(
            marketplaceContract
              .connect(buyer)
              .fulfillAdvancedOrder(order, [], toKey(false), {
                value,
              })
          ).to.be.revertedWith(`InvalidRestrictedOrder("${orderHash}")`);
        } else {
          await expect(
            marketplaceContract
              .connect(buyer)
              .fulfillAdvancedOrder(order, [], toKey(false), {
                value,
              })
          ).to.be.reverted;
        }
      });
      it("Reverts on restricted order where isValidOrder returns non-magic value", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          stubZone,
          offer,
          consideration,
          2, // FULL_RESTRICTED,
          [],
          null,
          seller,
          "0x".padEnd(65, "0") + "3"
        );

        const basicOrderParameters = getBasicOrderParameters(
          0, // EthForERC721
          order
        );

        if (!process.env.REFERENCE) {
          await expect(
            marketplaceContract
              .connect(buyer)
              .fulfillBasicOrder(basicOrderParameters, {
                value,
              })
          ).to.be.revertedWith(`InvalidRestrictedOrder("${orderHash}")`);
        } else {
          await expect(
            marketplaceContract
              .connect(buyer)
              .fulfillBasicOrder(basicOrderParameters, {
                value,
              })
          ).to.be.reverted;
        }

        if (!process.env.REFERENCE) {
          await expect(
            marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, toKey(false), {
                value,
              })
          ).to.be.revertedWith(`InvalidRestrictedOrder("${orderHash}")`);
        } else {
          await expect(
            marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, toKey(false), {
                value,
              })
          ).to.be.reverted;
        }

        order.extraData = "0x01";

        if (!process.env.REFERENCE) {
          await expect(
            marketplaceContract
              .connect(buyer)
              .fulfillAdvancedOrder(order, [], toKey(false), {
                value,
              })
          ).to.be.revertedWith(`InvalidRestrictedOrder("${orderHash}")`);
        } else {
          await expect(
            marketplaceContract
              .connect(buyer)
              .fulfillAdvancedOrder(order, [], toKey(false), {
                value,
              })
          ).to.be.reverted;
        }
      });
      it("Reverts on missing offer or consideration components", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const { mirrorOrder, mirrorOrderHash } = await createMirrorBuyNowOrder(
          buyer,
          zone,
          order
        );

        let fulfillments = [
          {
            offerComponents: [],
            considerationComponents: [],
          },
        ];

        await expect(
          marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments, { value })
        ).to.be.revertedWith("OfferAndConsiderationRequiredOnFulfillment");

        fulfillments = [
          {
            offerComponents: [],
            considerationComponents: [
              {
                orderIndex: 0,
                itemIndex: 0,
              },
            ],
          },
        ];

        await expect(
          marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments, { value })
        ).to.be.revertedWith("OfferAndConsiderationRequiredOnFulfillment");

        fulfillments = [
          {
            offerComponents: [
              {
                orderIndex: 0,
                itemIndex: 0,
              },
            ],
            considerationComponents: [],
          },
        ];

        await expect(
          marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments, {
              value,
            })
        ).to.be.revertedWith("OfferAndConsiderationRequiredOnFulfillment");

        fulfillments = defaultBuyNowMirrorFulfillment;

        const executions = await simulateMatchOrders(
          [order, mirrorOrder],
          fulfillments,
          owner,
          value
        );

        expect(executions.length).to.equal(4);

        const tx = await marketplaceContract
          .connect(owner)
          .matchOrders([order, mirrorOrder], fulfillments, {
            value,
          });
        const receipt = await tx.wait();
        await checkExpectedEvents(
          receipt,
          [
            {
              order,
              orderHash,
              fulfiller: constants.AddressZero,
            },
          ],
          executions
        );
        await checkExpectedEvents(
          receipt,
          [
            {
              order: mirrorOrder,
              orderHash: mirrorOrderHash,
              fulfiller: constants.AddressZero,
            },
          ],
          executions
        );
        return receipt;
      });
      it("Reverts on mismatched offer and consideration components", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const { mirrorOrder, mirrorOrderHash } = await createMirrorBuyNowOrder(
          buyer,
          zone,
          order
        );

        let fulfillments = [toFulfillment([[0, 0]], [[0, 0]])];

        await expect(
          marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments, {
              value,
            })
        ).to.be.revertedWith(
          "MismatchedFulfillmentOfferAndConsiderationComponents"
        );

        fulfillments = defaultBuyNowMirrorFulfillment;

        const executions = await simulateMatchOrders(
          [order, mirrorOrder],
          fulfillments,
          owner,
          value
        );

        expect(executions.length).to.equal(4);

        const tx = await marketplaceContract
          .connect(owner)
          .matchOrders([order, mirrorOrder], fulfillments, {
            value,
          });
        const receipt = await tx.wait();
        await checkExpectedEvents(
          receipt,
          [
            {
              order,
              orderHash,
              fulfiller: constants.AddressZero,
            },
          ],
          executions
        );
        await checkExpectedEvents(
          receipt,
          [
            {
              order: mirrorOrder,
              orderHash: mirrorOrderHash,
              fulfiller: constants.AddressZero,
            },
          ],
          executions
        );
        return receipt;
      });
      it("Reverts on mismatched offer components", async () => {
        // Seller mints nft
        const nftId = ethers.BigNumber.from(randomHex());
        await testERC721.mint(seller.address, nftId);

        const secondNFTId = ethers.BigNumber.from(randomHex());
        await testERC721.mint(seller.address, secondNFTId);

        // Seller approves marketplace contract to transfer NFT
        await set721ApprovalForAll(seller, marketplaceContract.address, true);

        const offer = [
          {
            itemType: 2, // ERC721
            token: testERC721.address,
            identifierOrCriteria: nftId,
            startAmount: ethers.BigNumber.from(1),
            endAmount: ethers.BigNumber.from(1),
          },
          {
            itemType: 2, // ERC721
            token: testERC721.address,
            identifierOrCriteria: secondNFTId,
            startAmount: ethers.BigNumber.from(1),
            endAmount: ethers.BigNumber.from(1),
          },
        ];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const { mirrorOrder } = await createMirrorBuyNowOrder(
          buyer,
          zone,
          order
        );

        const fulfillments = [
          [
            [
              [0, 0],
              [0, 1],
            ],
            [[1, 0]],
          ],
          [[[1, 0]], [[0, 0]]],
          [[[1, 0]], [[0, 1]]],
          [[[1, 0]], [[0, 2]]],
        ].map(([offerArr, considerationArr]) =>
          toFulfillment(offerArr, considerationArr)
        );

        await expect(
          marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments, {
              value,
            })
        ).to.be.revertedWith("InvalidFulfillmentComponentData");
      });
      it("Reverts on mismatched consideration components", async () => {
        // Seller mints nft
        const nftId = ethers.BigNumber.from(randomHex());
        await testERC721.mint(seller.address, nftId);

        const secondNFTId = ethers.BigNumber.from(randomHex());
        await testERC721.mint(seller.address, secondNFTId);

        // Seller approves marketplace contract to transfer NFT
        await set721ApprovalForAll(seller, marketplaceContract.address, true);

        const offer = [
          {
            itemType: 2, // ERC721
            token: testERC721.address,
            identifierOrCriteria: nftId,
            startAmount: ethers.BigNumber.from(1),
            endAmount: ethers.BigNumber.from(1),
          },
          {
            itemType: 2, // ERC721
            token: testERC721.address,
            identifierOrCriteria: secondNFTId,
            startAmount: ethers.BigNumber.from(1),
            endAmount: ethers.BigNumber.from(1),
          },
        ];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getTestItem20(
            ethers.utils.parseEther("1"),
            ethers.utils.parseEther("1"),
            zone.address
          ),
          getItemETH(1, 1, owner.address),
        ];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const { mirrorOrder } = await createMirrorBuyNowOrder(
          buyer,
          zone,
          order
        );

        const fulfillments = [
          [
            [[0, 0]],
            [
              [1, 0],
              [1, 1],
            ],
          ],
          [[[1, 0]], [[0, 0]]],
          [[[1, 0]], [[0, 1]]],
          [[[1, 0]], [[0, 2]]],
        ].map(([offerArr, considerationArr]) =>
          toFulfillment(offerArr, considerationArr)
        );

        await expect(
          marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments, {
              value,
            })
        ).to.be.revertedWith("InvalidFulfillmentComponentData");
      });
      it("Reverts on fulfillment component with out-of-range order", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const { mirrorOrder } = await createMirrorBuyNowOrder(
          buyer,
          zone,
          order
        );

        const fulfillments = [
          [
            [[2, 0]],
            [
              [1, 0],
              [1, 1],
            ],
          ],
          [[[1, 0]], [[0, 0]]],
          [[[1, 0]], [[0, 1]]],
          [[[1, 0]], [[0, 2]]],
        ].map(([offerArr, considerationArr]) =>
          toFulfillment(offerArr, considerationArr)
        );

        await expect(
          marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments, {
              value,
            })
        ).to.be.revertedWith("InvalidFulfillmentComponentData");
      });
      it("Reverts on fulfillment component with out-of-range offer item", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const { mirrorOrder } = await createMirrorBuyNowOrder(
          buyer,
          zone,
          order
        );

        const fulfillments = [
          [[[0, 5]], [[1, 0]]],
          [[[1, 0]], [[0, 0]]],
          [[[1, 0]], [[0, 1]]],
          [[[1, 0]], [[0, 2]]],
        ].map(([offerArr, considerationArr]) =>
          toFulfillment(offerArr, considerationArr)
        );

        await expect(
          marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments, {
              value,
            })
        ).to.be.revertedWith("InvalidFulfillmentComponentData");
      });
      it("Reverts on fulfillment component with out-of-range initial order on fulfillAvailableOrders", async () => {
        // Seller mints nft
        const nftId = ethers.BigNumber.from(randomHex().slice(0, 10));
        const amount = ethers.BigNumber.from(randomHex().slice(0, 10)).mul(2);
        await testERC1155.mint(seller.address, nftId, amount);

        // Seller approves marketplace contract to transfer NFT

        await set1155ApprovalForAll(seller, marketplaceContract.address, true);

        const offer = [
          getTestItem1155(nftId, amount.div(2), amount.div(2)),
          getTestItem1155(nftId, amount.div(2), amount.div(2)),
        ];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const offerComponents = [
          [
            [5, 0],
            [0, 0],
          ],
        ];

        const considerationComponents = [[[0, 0]], [[0, 1]], [[0, 2]]];

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAvailableOrders(
              [order],
              offerComponents,
              considerationComponents,
              toKey(false),
              100,
              {
                value,
              }
            )
        ).to.be.revertedWith("InvalidFulfillmentComponentData");
      });
      it("Reverts on fulfillment component with out-of-range initial offer item on fulfillAvailableOrders", async () => {
        // Seller mints nft
        const nftId = ethers.BigNumber.from(randomHex().slice(0, 10));
        const amount = ethers.BigNumber.from(randomHex().slice(0, 10)).mul(2);
        await testERC1155.mint(seller.address, nftId, amount);

        // Seller approves marketplace contract to transfer NFT

        await set1155ApprovalForAll(seller, marketplaceContract.address, true);

        const offer = [
          getTestItem1155(nftId, amount.div(2), amount.div(2)),
          getTestItem1155(nftId, amount.div(2), amount.div(2)),
        ];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const offerComponents = [
          [
            [0, 5],
            [0, 0],
          ],
        ];

        const considerationComponents = [[[0, 0]], [[0, 1]], [[0, 2]]];

        let success = false;

        try {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillAvailableOrders(
              [order],
              offerComponents,
              considerationComponents,
              toKey(false),
              100,
              {
                value,
              }
            );

          const receipt = await tx.wait();
          success = receipt.status;
        } catch (err) {}

        expect(success).to.be.false; // TODO: fix out-of-gas
      });
      it("Reverts on fulfillment component with out-of-range subsequent offer item on fulfillAvailableOrders", async () => {
        // Seller mints nft
        const nftId = ethers.BigNumber.from(randomHex().slice(0, 10));
        const amount = ethers.BigNumber.from(randomHex().slice(0, 10)).mul(2);
        await testERC1155.mint(seller.address, nftId, amount);

        // Seller approves marketplace contract to transfer NFT

        await set1155ApprovalForAll(seller, marketplaceContract.address, true);

        const offer = [
          getTestItem1155(nftId, amount.div(2), amount.div(2)),
          getTestItem1155(nftId, amount.div(2), amount.div(2)),
        ];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const offerComponents = [
          [
            [0, 0],
            [0, 5],
          ],
        ];

        const considerationComponents = [[[0, 0]], [[0, 1]], [[0, 2]]];

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAvailableOrders(
              [order],
              offerComponents,
              considerationComponents,
              toKey(false),
              100,
              {
                value,
              }
            )
        ).to.be.revertedWith("InvalidFulfillmentComponentData");
      });
      it("Reverts on fulfillment component with out-of-range consideration item", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const { mirrorOrder } = await createMirrorBuyNowOrder(
          buyer,
          zone,
          order
        );

        const fulfillments = [
          [[[0, 0]], [[1, 5]]],
          [[[1, 0]], [[0, 0]]],
          [[[1, 0]], [[0, 1]]],
          [[[1, 0]], [[0, 2]]],
        ].map(([offerArr, considerationArr]) =>
          toFulfillment(offerArr, considerationArr)
        );

        await expect(
          marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments, {
              value,
            })
        ).to.be.revertedWith("InvalidFulfillmentComponentData");
      });
      it("Reverts on unmet consideration items", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const { mirrorOrder } = await createMirrorBuyNowOrder(
          buyer,
          zone,
          order
        );

        const fulfillments = [
          [[[0, 0]], [[1, 0]]],
          [[[1, 0]], [[0, 0]]],
          [[[1, 0]], [[0, 1]]],
        ].map(([offerArr, considerationArr]) =>
          toFulfillment(offerArr, considerationArr)
        );

        await expect(
          marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments, {
              value,
            })
        ).to.be.revertedWith(
          `ConsiderationNotMet(0, 2, ${ethers.utils.parseEther("1").toString()}`
        );
      });
      it("Reverts on fulfillAvailableAdvancedOrders with empty fulfillment component", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const offerComponents = [[]];

        const considerationComponents = [[[0, 0]], [[0, 1]], [[0, 2]]];

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAvailableAdvancedOrders(
              [order],
              [],
              offerComponents,
              considerationComponents,
              toKey(false),
              100,
              {
                value,
              }
            )
        ).to.be.revertedWith("MissingFulfillmentComponentOnAggregation(0)");
      });
      it("Reverts on fulfillAvailableAdvancedOrders with out-of-range initial offer order", async () => {
        // Seller mints nft
        const nftId = ethers.BigNumber.from(randomHex().slice(0, 10));
        const amount = ethers.BigNumber.from(randomHex().slice(0, 10));
        await testERC1155.mint(seller.address, nftId, amount.mul(2));

        // Seller approves marketplace contract to transfer NFT

        await set1155ApprovalForAll(seller, marketplaceContract.address, true);

        const offer = [
          getTestItem1155(nftId, amount, amount, undefined),
          getTestItem1155(nftId, amount, amount, undefined),
        ];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const offerComponents = [
          [
            [2, 0],
            [0, 0],
          ],
        ];

        const considerationComponents = [[[0, 0]], [[0, 1]], [[0, 2]]];

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAvailableAdvancedOrders(
              [order],
              [],
              offerComponents,
              considerationComponents,
              toKey(false),
              100,
              {
                value,
              }
            )
        ).to.be.revertedWith("InvalidFulfillmentComponentData");
      });
      it("Reverts on fulfillAvailableAdvancedOrders with out-of-range offer order", async () => {
        // Seller mints nft
        const nftId = ethers.BigNumber.from(randomHex().slice(0, 10));
        const amount = ethers.BigNumber.from(randomHex().slice(0, 10));
        await testERC1155.mint(seller.address, nftId, amount.mul(2));

        // Seller approves marketplace contract to transfer NFT

        await set1155ApprovalForAll(seller, marketplaceContract.address, true);

        const offer = [
          getTestItem1155(nftId, amount, amount, undefined),
          getTestItem1155(nftId, amount, amount, undefined),
        ];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const offerComponents = [
          [
            [0, 0],
            [2, 0],
          ],
        ];

        const considerationComponents = [[[0, 0]], [[0, 1]], [[0, 2]]];

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAvailableAdvancedOrders(
              [order],
              [],
              offerComponents,
              considerationComponents,
              toKey(false),
              100,
              {
                value,
              }
            )
        ).to.be.revertedWith("InvalidFulfillmentComponentData");
      });
      it("Reverts on fulfillAvailableAdvancedOrders with mismatched offer components", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [
          {
            itemType: 0, // ETH
            token: constants.AddressZero,
            identifierOrCriteria: 0, // ignored for ETH
            startAmount: ethers.utils.parseEther("1"),
            endAmount: ethers.utils.parseEther("1"),
          },
          {
            itemType: 2, // ERC721
            token: testERC721.address,
            identifierOrCriteria: nftId,
            startAmount: ethers.BigNumber.from(1),
            endAmount: ethers.BigNumber.from(1),
          },
        ];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const offerComponents = [
          [
            [0, 0],
            [0, 1],
          ],
        ];

        const considerationComponents = [[[0, 0]], [[0, 1]], [[0, 2]]];

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAvailableAdvancedOrders(
              [order],
              [],
              offerComponents,
              considerationComponents,
              toKey(false),
              100,
              {
                value,
              }
            )
        ).to.be.revertedWith("InvalidFulfillmentComponentData");
      });
      it("Reverts on fulfillAvailableAdvancedOrders with out-of-range consideration order", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const offerComponents = [[[0, 0]]];

        const considerationComponents = [
          [
            [0, 0],
            [2, 1],
          ],
          [[2, 2]],
        ];

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAvailableAdvancedOrders(
              [order],
              [],
              offerComponents,
              considerationComponents,
              toKey(false),
              100,
              {
                value,
              }
            )
        ).to.be.revertedWith("InvalidFulfillmentComponentData");
      });
      it("Reverts on fulfillAvailableAdvancedOrders with mismatched consideration components", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          {
            itemType: 2, // ERC721
            token: testERC721.address,
            identifierOrCriteria: nftId,
            startAmount: ethers.BigNumber.from(1),
            endAmount: ethers.BigNumber.from(1),
            recipient: zone.address,
          },
        ];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const offerComponents = [[[0, 0]]];

        const considerationComponents = [
          [
            [0, 0],
            [0, 1],
          ],
        ];

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAvailableAdvancedOrders(
              [order],
              [],
              offerComponents,
              considerationComponents,
              toKey(false),
              100,
              {
                value,
              }
            )
        ).to.be.revertedWith("InvalidFulfillmentComponentData");
      });
      it("Reverts on fulfillAvailableAdvancedOrders no available components", async () => {
        // Seller mints nft
        const nftId = ethers.BigNumber.from(randomHex().slice(0, 10));
        const amount = ethers.BigNumber.from(randomHex().slice(0, 10)).mul(2);
        await testERC1155.mint(seller.address, nftId, amount);

        // Seller approves marketplace contract to transfer NFT

        await set1155ApprovalForAll(seller, marketplaceContract.address, true);

        const offer = [getTestItem1155(nftId, amount.div(2), amount.div(2))];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        // first order is expired
        const { order: orderOne, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0, // FULL_OPEN
          [],
          "EXPIRED"
        );

        // second order will be cancelled
        const {
          order: orderTwo,
          orderHash: orderHashTwo,
          orderComponents,
        } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        // can cancel it
        await expect(
          marketplaceContract.connect(seller).cancel([orderComponents])
        )
          .to.emit(marketplaceContract, "OrderCancelled")
          .withArgs(orderHashTwo, seller.address, zone.address);

        // third order will be filled
        const { order: orderThree, orderHash: orderHashThree } =
          await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0 // FULL_OPEN
          );

        // can fill it
        await withBalanceChecks([orderThree], 0, null, async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillOrder(orderThree, toKey(false), {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(receipt, [
            {
              order: orderThree,
              orderHash: orderHashThree,
              fulfiller: buyer.address,
            },
          ]);
          return receipt;
        });

        const offerComponents = [
          [
            [0, 0],
            [1, 0],
            [2, 0],
          ],
        ];

        const considerationComponents = [
          [
            [0, 0],
            [1, 0],
            [2, 0],
          ],
          [
            [0, 1],
            [1, 1],
            [2, 1],
          ],
          [
            [0, 2],
            [1, 2],
            [2, 2],
          ],
        ];

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAvailableAdvancedOrders(
              [orderOne, orderTwo, orderThree],
              [],
              offerComponents,
              considerationComponents,
              toKey(false),
              100,
              {
                value: value.mul(3),
              }
            )
        ).to.be.revertedWith("NoSpecifiedOrdersAvailable");
      });
      it("Reverts on out-of-range criteria resolvers", async () => {
        // Seller mints nfts
        const nftId = ethers.BigNumber.from(randomHex());
        const secondNFTId = ethers.BigNumber.from(randomHex());
        const thirdNFTId = ethers.BigNumber.from(randomHex());

        await testERC721.mint(seller.address, nftId);
        await testERC721.mint(seller.address, secondNFTId);
        await testERC721.mint(seller.address, thirdNFTId);

        const tokenIds = [nftId, secondNFTId, thirdNFTId];

        // Seller approves marketplace contract to transfer NFTs
        await set721ApprovalForAll(seller, marketplaceContract.address, true);

        const { root, proofs } = merkleTree(tokenIds);

        const offer = [
          {
            itemType: 4, // ERC721WithCriteria
            token: testERC721.address,
            identifierOrCriteria: root,
            startAmount: ethers.BigNumber.from(1),
            endAmount: ethers.BigNumber.from(1),
          },
        ];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        let criteriaResolvers = [
          {
            orderIndex: 3,
            side: 0, // offer
            index: 0,
            identifier: nftId,
            criteriaProof: proofs[nftId.toString()],
          },
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0, // FULL_OPEN
          criteriaResolvers
        );

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, criteriaResolvers, toKey(false), {
              value,
            })
        ).to.be.revertedWith("OrderCriteriaResolverOutOfRange");

        criteriaResolvers = [
          {
            orderIndex: 0,
            side: 0, // offer
            index: 5,
            identifier: nftId,
            criteriaProof: proofs[nftId.toString()],
          },
        ];

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, criteriaResolvers, toKey(false), {
              value,
            })
        ).to.be.revertedWith("OfferCriteriaResolverOutOfRange");

        criteriaResolvers = [
          {
            orderIndex: 0,
            side: 1, // consideration
            index: 5,
            identifier: nftId,
            criteriaProof: proofs[nftId.toString()],
          },
        ];

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, criteriaResolvers, toKey(false), {
              value,
            })
        ).to.be.revertedWith("ConsiderationCriteriaResolverOutOfRange");

        criteriaResolvers = [
          {
            orderIndex: 0,
            side: 0, // offer
            index: 0,
            identifier: nftId,
            criteriaProof: proofs[nftId.toString()],
          },
        ];

        await withBalanceChecks([order], 0, criteriaResolvers, async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, criteriaResolvers, toKey(false), {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ],
            null,
            criteriaResolvers
          );
          return receipt;
        });
      });
      if (process.env.REFERENCE) {
        it("Reverts on out-of-range criteria resolver (match)", async () => {
          // Seller mints nfts
          const nftId = ethers.BigNumber.from(randomHex());

          await testERC721.mint(seller.address, nftId);

          // Seller approves marketplace contract to transfer NFTs
          await set721ApprovalForAll(seller, marketplaceContract.address, true);

          const { root, proofs } = merkleTree([nftId]);

          const offer = [
            {
              itemType: 4, // ERC721WithCriteria
              token: testERC721.address,
              identifierOrCriteria: root,
              startAmount: ethers.BigNumber.from(1),
              endAmount: ethers.BigNumber.from(1),
            },
          ];

          const consideration = [
            getItemETH(10, 10, seller.address),
            getItemETH(1, 1, zone.address),
            getItemETH(1, 1, owner.address),
          ];

          let criteriaResolvers = [
            {
              orderIndex: 3,
              side: 0, // offer
              index: 0,
              identifier: nftId,
              criteriaProof: proofs[nftId.toString()],
            },
          ];

          const { order, orderHash, value } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0, // FULL_OPEN
            criteriaResolvers
          );

          const { mirrorOrder, mirrorOrderHash } =
            await createMirrorAcceptOfferOrder(
              buyer,
              zone,
              order,
              criteriaResolvers
            );

          const fulfillments = [toFulfillment([[1, 0]], [[0, 0]])];

          await expect(
            marketplaceContract
              .connect(owner)
              .matchAdvancedOrders(
                [order, mirrorOrder],
                criteriaResolvers,
                fulfillments,
                {
                  value,
                }
              )
          ).to.be.revertedWith("OrderCriteriaResolverOutOfRange");

          criteriaResolvers = [
            {
              orderIndex: 0,
              side: 0, // offer
              index: 5,
              identifier: nftId,
              criteriaProof: proofs[nftId.toString()],
            },
          ];

          await expect(
            marketplaceContract
              .connect(owner)
              .matchAdvancedOrders(
                [order, mirrorOrder],
                criteriaResolvers,
                fulfillments,
                {
                  value,
                }
              )
          ).to.be.revertedWith("OfferCriteriaResolverOutOfRange");

          criteriaResolvers = [
            {
              orderIndex: 0,
              side: 1, // consideration
              index: 5,
              identifier: nftId,
              criteriaProof: proofs[nftId.toString()],
            },
          ];

          await expect(
            marketplaceContract
              .connect(owner)
              .matchAdvancedOrders(
                [order, mirrorOrder],
                criteriaResolvers,
                fulfillments,
                {
                  value,
                }
              )
          ).to.be.revertedWith("ConsiderationCriteriaResolverOutOfRange");
        });
      }
      it("Reverts on unresolved criteria items", async () => {
        // Seller and buyer both mints nfts
        const nftId = ethers.BigNumber.from(randomHex());
        const secondNFTId = ethers.BigNumber.from(randomHex());

        await testERC721.mint(seller.address, nftId);
        await testERC721.mint(buyer.address, secondNFTId);

        const tokenIds = [nftId, secondNFTId];

        // Seller approves marketplace contract to transfer NFTs
        await set721ApprovalForAll(seller, marketplaceContract.address, true);

        // Buyer approves marketplace contract to transfer NFTs
        await set721ApprovalForAll(buyer, marketplaceContract.address, true);

        const { root, proofs } = merkleTree(tokenIds);

        const offer = [
          {
            itemType: 4, // ERC721WithCriteria
            token: testERC721.address,
            identifierOrCriteria: root,
            startAmount: ethers.BigNumber.from(1),
            endAmount: ethers.BigNumber.from(1),
          },
        ];

        const consideration = [
          {
            itemType: 4, // ERC721WithCriteria
            token: testERC721.address,
            identifierOrCriteria: root,
            startAmount: ethers.BigNumber.from(1),
            endAmount: ethers.BigNumber.from(1),
            recipient: owner.address,
          },
        ];

        let criteriaResolvers = [
          {
            orderIndex: 0,
            side: 0, // offer
            index: 0,
            identifier: nftId,
            criteriaProof: proofs[nftId.toString()],
          },
          {
            orderIndex: 0,
            side: 1, // consideration
            index: 0,
            identifier: secondNFTId,
            criteriaProof: proofs[secondNFTId.toString()],
          },
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0, // FULL_OPEN
          criteriaResolvers
        );

        criteriaResolvers = [
          {
            orderIndex: 0,
            side: 0, // offer
            index: 0,
            identifier: nftId,
            criteriaProof: proofs[nftId.toString()],
          },
        ];

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, criteriaResolvers, toKey(false), {
              value,
            })
        ).to.be.revertedWith("UnresolvedConsiderationCriteria");

        criteriaResolvers = [
          {
            orderIndex: 0,
            side: 1, // consideration
            index: 0,
            identifier: secondNFTId,
            criteriaProof: proofs[secondNFTId.toString()],
          },
        ];

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, criteriaResolvers, toKey(false), {
              value,
            })
        ).to.be.revertedWith("UnresolvedOfferCriteria");

        criteriaResolvers = [
          {
            orderIndex: 0,
            side: 0, // offer
            index: 0,
            identifier: nftId,
            criteriaProof: proofs[nftId.toString()],
          },
          {
            orderIndex: 0,
            side: 1, // consideration
            index: 0,
            identifier: secondNFTId,
            criteriaProof: proofs[secondNFTId.toString()],
          },
        ];

        await withBalanceChecks([order], 0, criteriaResolvers, async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, criteriaResolvers, toKey(false), {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ],
            null,
            criteriaResolvers
          );
          return receipt;
        });
      });
      if (process.env.REFERENCE) {
        it("Reverts on unresolved criteria items (match)", async () => {
          // Seller mints nfts
          const nftId = ethers.BigNumber.from(randomHex());
          const secondNFTId = ethers.BigNumber.from(randomHex());

          await testERC721.mint(seller.address, nftId);
          await testERC721.mint(seller.address, secondNFTId);

          const tokenIds = [nftId, secondNFTId];

          // Seller approves marketplace contract to transfer NFTs
          await set721ApprovalForAll(seller, marketplaceContract.address, true);

          const { root, proofs } = merkleTree(tokenIds);

          const offer = [
            {
              itemType: 4, // ERC721WithCriteria
              token: testERC721.address,
              identifierOrCriteria: root,
              startAmount: ethers.BigNumber.from(1),
              endAmount: ethers.BigNumber.from(1),
            },
          ];

          const consideration = [
            {
              itemType: 4, // ERC721WithCriteria
              token: testERC721.address,
              identifierOrCriteria: root,
              startAmount: ethers.BigNumber.from(1),
              endAmount: ethers.BigNumber.from(1),
              recipient: owner.address,
            },
          ];

          let criteriaResolvers = [
            {
              orderIndex: 0,
              side: 0, // offer
              index: 0,
              identifier: nftId,
              criteriaProof: proofs[nftId.toString()],
            },
            {
              orderIndex: 0,
              side: 1, // consideration
              index: 0,
              identifier: secondNFTId,
              criteriaProof: proofs[secondNFTId.toString()],
            },
          ];

          const { order, value } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0, // FULL_OPEN
            criteriaResolvers
          );

          criteriaResolvers = [
            {
              orderIndex: 0,
              side: 0, // offer
              index: 0,
              identifier: nftId,
              criteriaProof: proofs[nftId.toString()],
            },
          ];

          const { mirrorOrder } = await createMirrorAcceptOfferOrder(
            buyer,
            zone,
            order,
            criteriaResolvers
          );

          const fulfillments = [toFulfillment([[1, 0]], [[0, 0]])];

          await expect(
            marketplaceContract
              .connect(owner)
              .matchAdvancedOrders(
                [order, mirrorOrder],
                criteriaResolvers,
                fulfillments,
                {
                  value,
                }
              )
          ).to.be.revertedWith("UnresolvedConsiderationCriteria");

          criteriaResolvers = [
            {
              orderIndex: 0,
              side: 1, // consideration
              index: 0,
              identifier: secondNFTId,
              criteriaProof: proofs[secondNFTId.toString()],
            },
          ];

          await expect(
            marketplaceContract
              .connect(owner)
              .matchAdvancedOrders(
                [order, mirrorOrder],
                criteriaResolvers,
                fulfillments,
                {
                  value,
                }
              )
          ).to.be.revertedWith("UnresolvedOfferCriteria");

          criteriaResolvers = [
            {
              orderIndex: 0,
              side: 0, // offer
              index: 0,
              identifier: nftId,
              criteriaProof: proofs[nftId.toString()],
            },
            {
              orderIndex: 0,
              side: 1, // consideration
              index: 0,
              identifier: secondNFTId,
              criteriaProof: proofs[secondNFTId.toString()],
            },
          ];
        });
      }
      it("Reverts on attempts to resolve criteria for non-criteria item", async () => {
        // Seller mints nfts
        const nftId = ethers.BigNumber.from(randomHex());
        const secondNFTId = ethers.BigNumber.from(randomHex());
        const thirdNFTId = ethers.BigNumber.from(randomHex());

        await testERC721.mint(seller.address, nftId);
        await testERC721.mint(seller.address, secondNFTId);
        await testERC721.mint(seller.address, thirdNFTId);

        const tokenIds = [nftId, secondNFTId, thirdNFTId];

        // Seller approves marketplace contract to transfer NFTs
        await set721ApprovalForAll(seller, marketplaceContract.address, true);

        const { proofs } = merkleTree(tokenIds);

        const offer = [
          {
            itemType: 2, // ERC721
            token: testERC721.address,
            identifierOrCriteria: nftId,
            startAmount: ethers.BigNumber.from(1),
            endAmount: ethers.BigNumber.from(1),
          },
        ];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const criteriaResolvers = [
          {
            orderIndex: 0,
            side: 0, // offer
            index: 0,
            identifier: nftId,
            criteriaProof: proofs[nftId.toString()],
          },
        ];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0, // FULL_OPEN
          criteriaResolvers
        );

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, criteriaResolvers, toKey(false), {
              value,
            })
        ).to.be.revertedWith("CriteriaNotEnabledForItem");
      });
      if (process.env.REFERENCE) {
        it("Reverts on attempts to resolve criteria for non-criteria item (match)", async () => {
          // Seller mints nfts
          const nftId = ethers.BigNumber.from(randomHex());

          await testERC721.mint(seller.address, nftId);

          // Seller approves marketplace contract to transfer NFTs
          await set721ApprovalForAll(seller, marketplaceContract.address, true);

          const { root, proofs } = merkleTree([nftId]);

          const offer = [
            {
              itemType: 2, // ERC721
              token: testERC721.address,
              identifierOrCriteria: root,
              startAmount: ethers.BigNumber.from(1),
              endAmount: ethers.BigNumber.from(1),
            },
          ];

          const consideration = [
            getItemETH(10, 10, seller.address),
            getItemETH(1, 1, zone.address),
            getItemETH(1, 1, owner.address),
          ];

          const criteriaResolvers = [
            {
              orderIndex: 0,
              side: 0, // offer
              index: 0,
              identifier: nftId,
              criteriaProof: proofs[nftId.toString()],
            },
          ];

          const { order, value } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0, // FULL_OPEN
            criteriaResolvers
          );

          const { mirrorOrder } = await createMirrorAcceptOfferOrder(
            buyer,
            zone,
            order,
            criteriaResolvers
          );

          const fulfillments = [toFulfillment([[1, 0]], [[0, 0]])];

          await expect(
            marketplaceContract
              .connect(owner)
              .matchAdvancedOrders(
                [order, mirrorOrder],
                criteriaResolvers,
                fulfillments,
                {
                  value,
                }
              )
          ).to.be.revertedWith("CriteriaNotEnabledForItem");
        });
      }
      it("Reverts on invalid criteria proof", async () => {
        // Seller mints nfts
        const nftId = ethers.BigNumber.from(randomHex());
        const secondNFTId = ethers.BigNumber.from(randomHex());
        const thirdNFTId = ethers.BigNumber.from(randomHex());

        await testERC721.mint(seller.address, nftId);
        await testERC721.mint(seller.address, secondNFTId);
        await testERC721.mint(seller.address, thirdNFTId);

        const tokenIds = [nftId, secondNFTId, thirdNFTId];

        // Seller approves marketplace contract to transfer NFTs
        await set721ApprovalForAll(seller, marketplaceContract.address, true);

        const { root, proofs } = merkleTree(tokenIds);

        const offer = [
          {
            itemType: 4, // ERC721WithCriteria
            token: testERC721.address,
            identifierOrCriteria: root,
            startAmount: ethers.BigNumber.from(1),
            endAmount: ethers.BigNumber.from(1),
          },
        ];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const criteriaResolvers = [
          {
            orderIndex: 0,
            side: 0, // consideration
            index: 0,
            identifier: nftId,
            criteriaProof: proofs[nftId.toString()],
          },
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0, // FULL_OPEN
          criteriaResolvers
        );

        criteriaResolvers[0].identifier =
          criteriaResolvers[0].identifier.add(1);

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, criteriaResolvers, toKey(false), {
              value,
            })
        ).to.be.revertedWith("InvalidProof");

        criteriaResolvers[0].identifier =
          criteriaResolvers[0].identifier.sub(1);

        await withBalanceChecks([order], 0, criteriaResolvers, async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, criteriaResolvers, toKey(false), {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ],
            null,
            criteriaResolvers
          );
          return receipt;
        });
      });
      it("Reverts on attempts to transfer >1 ERC721 in single transfer", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [
          {
            itemType: 2, // ERC721
            token: testERC721.address,
            identifierOrCriteria: nftId,
            startAmount: ethers.BigNumber.from(2),
            endAmount: ethers.BigNumber.from(2),
          },
        ];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        await expect(
          marketplaceContract.connect(buyer).fulfillOrder(order, toKey(false), {
            value,
          })
        ).to.be.revertedWith("InvalidERC721TransferAmount");
      });
      it("Reverts on attempts to transfer >1 ERC721 in single transfer (basic)", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [
          {
            itemType: 2, // ERC721
            token: testERC721.address,
            identifierOrCriteria: nftId,
            startAmount: ethers.BigNumber.from(2),
            endAmount: ethers.BigNumber.from(2),
          },
        ];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const basicOrderParameters = getBasicOrderParameters(
          0, // EthForERC721
          order
        );

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillBasicOrder(basicOrderParameters, {
              value,
            })
        ).to.be.revertedWith("InvalidERC721TransferAmount");
      });
      it("Reverts on attempts to transfer >1 ERC721 in single transfer via conduit", async () => {
        const nftId = await mintAndApprove721(seller, conduitOne.address, true);

        const offer = [
          {
            itemType: 2, // ERC721
            token: testERC721.address,
            identifierOrCriteria: nftId,
            startAmount: ethers.BigNumber.from(2),
            endAmount: ethers.BigNumber.from(2),
          },
        ];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0, // FULL_OPEN
          [],
          null,
          seller,
          constants.HashZero,
          conduitKeyOne
        );

        await expect(
          marketplaceContract.connect(buyer).fulfillOrder(order, toKey(false), {
            value,
          })
        ).to.be.revertedWith("InvalidERC721TransferAmount");
      });
    });

    describe("Out of timespan", async () => {
      it("Reverts on orders that have not started (standard)", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0, // FULL_OPEN
          [],
          "NOT_STARTED"
        );

        await expect(
          marketplaceContract.connect(buyer).fulfillOrder(order, toKey(false), {
            value,
          })
        ).to.be.revertedWith("InvalidTime");
      });
      it("Reverts on orders that have expired (standard)", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0, // FULL_OPEN
          [],
          "EXPIRED"
        );

        await expect(
          marketplaceContract.connect(buyer).fulfillOrder(order, toKey(false), {
            value,
          })
        ).to.be.revertedWith("InvalidTime");
      });
      it("Reverts on orders that have not started (basic)", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0, // FULL_OPEN
          [],
          "NOT_STARTED"
        );

        const basicOrderParameters = getBasicOrderParameters(
          0, // EthForERC721
          order
        );

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillBasicOrder(basicOrderParameters, {
              value,
            })
        ).to.be.revertedWith("InvalidTime");
      });
      it("Reverts on orders that have expired (basic)", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0, // FULL_OPEN
          [],
          "EXPIRED"
        );

        const basicOrderParameters = getBasicOrderParameters(
          0, // EthForERC721
          order
        );

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillBasicOrder(basicOrderParameters, {
              value,
            })
        ).to.be.revertedWith("InvalidTime");
      });
      it("Reverts on orders that have not started (match)", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0, // FULL_OPEN
          [],
          "NOT_STARTED"
        );

        const { mirrorOrder } = await createMirrorBuyNowOrder(
          buyer,
          zone,
          order
        );

        const fulfillments = defaultBuyNowMirrorFulfillment;

        await expect(
          marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments, {
              value,
            })
        ).to.be.revertedWith("InvalidTime");
      });
      it("Reverts on orders that have expired (match)", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0, // FULL_OPEN
          [],
          "EXPIRED"
        );

        const { mirrorOrder } = await createMirrorBuyNowOrder(
          buyer,
          zone,
          order
        );

        const fulfillments = defaultBuyNowMirrorFulfillment;

        await expect(
          marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments, {
              value,
            })
        ).to.be.revertedWith("InvalidTime");
      });
    });

    describe("Insufficient amounts and bad items", async () => {
      it("Reverts when no ether is supplied (basic)", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const basicOrderParameters = getBasicOrderParameters(
          0, // EthForERC721
          order
        );

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillBasicOrder(basicOrderParameters, {
              value: ethers.BigNumber.from(0),
            })
        ).to.be.revertedWith("InvalidMsgValue");

        await withBalanceChecks([order], 0, null, async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillBasicOrder(basicOrderParameters, {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(receipt, [
            {
              order,
              orderHash,
              fulfiller: buyer.address,
            },
          ]);
          return receipt;
        });
      });
      it("Reverts when not enough ether is supplied (basic)", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const basicOrderParameters = getBasicOrderParameters(
          0, // EthForERC721
          order
        );

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillBasicOrder(basicOrderParameters, {
              value: ethers.BigNumber.from(1),
            })
        ).to.be.revertedWith("InsufficientEtherSupplied");

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillBasicOrder(basicOrderParameters, {
              value: value.sub(1),
            })
        ).to.be.revertedWith("InsufficientEtherSupplied");

        await withBalanceChecks([order], 0, null, async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillBasicOrder(basicOrderParameters, {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(receipt, [
            {
              order,
              orderHash,
              fulfiller: buyer.address,
            },
          ]);
          return receipt;
        });
      });
      it("Reverts when not enough ether is supplied as offer item (standard)", async () => {
        // NOTE: this is a ridiculous scenario, buyer is paying the seller's offer

        // buyer mints nft
        const nftId = await mintAndApprove721(
          buyer,
          marketplaceContract.address
        );

        const offer = [getItemETH(10, 10)];

        const consideration = [
          {
            itemType: 2, // ERC721
            token: testERC721.address,
            identifierOrCriteria: nftId,
            startAmount: ethers.BigNumber.from(1),
            endAmount: ethers.BigNumber.from(1),
            recipient: seller.address,
          },
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        await expect(
          marketplaceContract.connect(buyer).fulfillOrder(order, toKey(false), {
            value: ethers.BigNumber.from(1),
          })
        ).to.be.revertedWith("InsufficientEtherSupplied");

        await expect(
          marketplaceContract.connect(buyer).fulfillOrder(order, toKey(false), {
            value: ethers.utils.parseEther("9.999999"),
          })
        ).to.be.revertedWith("InsufficientEtherSupplied");

        await withBalanceChecks(
          [order],
          ethers.utils.parseEther("10").mul(-1),
          null,
          async () => {
            const tx = await marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, toKey(false), {
                value: ethers.utils.parseEther("12"),
              });
            const receipt = await tx.wait();
            await checkExpectedEvents(receipt, [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ]);
            return receipt;
          }
        );
      });
      it("Reverts when not enough ether is supplied (standard + advanced)", async () => {
        // Seller mints nft
        const { nftId, amount } = await mintAndApprove1155(
          seller,
          marketplaceContract.address,
          10000
        );

        const offer = [getTestItem1155(nftId, amount.mul(10), amount.mul(10))];

        const consideration = [
          {
            itemType: 0, // ETH
            token: constants.AddressZero,
            identifierOrCriteria: 0, // ignored for ETH
            startAmount: amount.mul(1000),
            endAmount: amount.mul(1000),
            recipient: seller.address,
          },
          {
            itemType: 0, // ETH
            token: constants.AddressZero,
            identifierOrCriteria: 0, // ignored for ETH
            startAmount: amount.mul(10),
            endAmount: amount.mul(10),
            recipient: zone.address,
          },
          {
            itemType: 0, // ETH
            token: constants.AddressZero,
            identifierOrCriteria: 0, // ignored for ETH
            startAmount: amount.mul(20),
            endAmount: amount.mul(20),
            recipient: owner.address,
          },
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        let orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(false);
        expect(orderStatus.totalFilled).to.equal(0);
        expect(orderStatus.totalSize).to.equal(0);

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value: ethers.BigNumber.from(1),
            })
        ).to.be.revertedWith("InsufficientEtherSupplied");

        orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(false);
        expect(orderStatus.totalFilled).to.equal(0);
        expect(orderStatus.totalSize).to.equal(0);

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value: value.sub(1),
            })
        ).to.be.revertedWith("InsufficientEtherSupplied");

        orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(false);
        expect(orderStatus.totalFilled).to.equal(0);
        expect(orderStatus.totalSize).to.equal(0);

        // fulfill with a tiny bit extra to test for returning eth
        await withBalanceChecks([order], 0, [], async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value: value.add(1),
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ],
            null,
            []
          );
          return receipt;
        });

        orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(true);
        expect(orderStatus.totalFilled).to.equal(1);
        expect(orderStatus.totalSize).to.equal(1);
      });
      it("Reverts when not enough ether is supplied (match)", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const { mirrorOrder, mirrorOrderHash } = await createMirrorBuyNowOrder(
          buyer,
          zone,
          order
        );

        const fulfillments = defaultBuyNowMirrorFulfillment;

        const executions = await simulateMatchOrders(
          [order, mirrorOrder],
          fulfillments,
          owner,
          value
        );

        expect(executions.length).to.equal(4);

        await expect(
          marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments, {
              value: ethers.BigNumber.from(1),
            })
        ).to.be.revertedWith("InsufficientEtherSupplied");

        await expect(
          marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments, {
              value: value.sub(1),
            })
        ).to.be.revertedWith("InsufficientEtherSupplied");

        await whileImpersonating(owner.address, provider, async () => {
          const tx = await marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments, {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          await checkExpectedEvents(
            receipt,
            [
              {
                order: mirrorOrder,
                orderHash: mirrorOrderHash,
                fulfiller: constants.AddressZero,
              },
            ],
            executions
          );
          return receipt;
        });
      });
      it("Reverts when ether is supplied to a non-payable route (basic)", async () => {
        // Seller mints nft
        const nftId = ethers.BigNumber.from(randomHex());
        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, marketplaceContract.address),
        ];

        const { order } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const basicOrderParameters = getBasicOrderParameters(
          2, // ERC20_TO_ERC721
          order
        );

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillBasicOrder(basicOrderParameters, {
              value: 1,
            })
        ).to.be.revertedWith("InvalidMsgValue(1)");
      });

      it(`Reverts when ether transfer fails (returndata)${
        process.env.REFERENCE ? " — SKIPPED ON REFERENCE" : ""
      }`, async () => {
        if (process.env.REFERENCE) {
          return;
        }

        const recipient = await (
          await ethers.getContractFactory("ExcessReturnDataRecipient")
        ).deploy();
        const setup = async () => {
          const nftId = await mintAndApprove721(
            seller,
            marketplaceContract.address
          );

          // Buyer mints ERC20
          const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);
          await testERC20.mint(buyer.address, tokenAmount);

          // Seller approves marketplace contract to transfer NFT
          await set721ApprovalForAll(seller, marketplaceContract.address, true);

          // Buyer approves marketplace contract to transfer tokens

          await expect(
            testERC20
              .connect(buyer)
              .approve(marketplaceContract.address, tokenAmount)
          )
            .to.emit(testERC20, "Approval")
            .withArgs(buyer.address, marketplaceContract.address, tokenAmount);
          const offer = [getTestItem721(nftId)];

          const consideration = [
            getItemETH(10, 10, seller.address),
            getItemETH(1, 1, recipient.address),
          ];

          const { order } = await createOrder(
            seller,
            zone,
            offer,
            consideration,
            0 // FULL_OPEN
          );

          const basicOrderParameters = getBasicOrderParameters(
            0, // EthForERC721
            order
          );
          return basicOrderParameters;
        };
        let basicOrderParameters = await setup();
        const baseGas = await marketplaceContract
          .connect(buyer)
          .estimateGas.fulfillBasicOrder(basicOrderParameters, {
            value: ethers.utils.parseEther("12"),
          });

        // TODO: clean *this* up
        basicOrderParameters = await setup();
        await recipient.setRevertDataSize(1);

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillBasicOrder(basicOrderParameters, {
              value: ethers.utils.parseEther("12"),
              gasLimit: hre.__SOLIDITY_COVERAGE_RUNNING
                ? baseGas.add(35000)
                : baseGas.add(1000),
            })
        ).to.be.revertedWith("EtherTransferGenericFailure");
      });

      it("Reverts when ether transfer fails (basic)", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        // Buyer mints ERC20
        const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);
        await testERC20.mint(buyer.address, tokenAmount);

        // Seller approves marketplace contract to transfer NFT
        await set721ApprovalForAll(seller, marketplaceContract.address, true);

        // Buyer approves marketplace contract to transfer tokens

        await expect(
          testERC20
            .connect(buyer)
            .approve(marketplaceContract.address, tokenAmount)
        )
          .to.emit(testERC20, "Approval")
          .withArgs(buyer.address, marketplaceContract.address, tokenAmount);

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, marketplaceContract.address),
        ];

        const { order } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const basicOrderParameters = getBasicOrderParameters(
          0, // EthForERC721
          order
        );

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillBasicOrder(basicOrderParameters, {
              value: ethers.utils.parseEther("12"),
            })
        ).to.be.revertedWith(
          `EtherTransferGenericFailure("${
            marketplaceContract.address
          }", ${ethers.utils.parseEther("1").toString()})`
        );
      });
      it("Reverts when tokens are not approved", async () => {
        // Seller mints nft
        const { nftId, amount } = await mintAndApprove1155(
          seller,
          marketplaceContract.address,
          10000
        );

        // Buyer mints ERC20
        const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);
        await testERC20.mint(buyer.address, tokenAmount);

        const offer = [getTestItem1155(nftId, amount.mul(10), amount.mul(10))];

        const consideration = [
          getTestItem20(amount.mul(1000), amount.mul(1000), seller.address),
          getTestItem20(amount.mul(10), amount.mul(10), zone.address),
          getTestItem20(amount.mul(20), amount.mul(20), owner.address),
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value,
            })
        ).to.be.reverted; // panic code thrown by underlying 721

        let orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(false);
        expect(orderStatus.totalFilled).to.equal(0);
        expect(orderStatus.totalSize).to.equal(0);

        // Buyer approves marketplace contract to transfer tokens
        await expect(
          testERC20
            .connect(buyer)
            .approve(marketplaceContract.address, tokenAmount)
        )
          .to.emit(testERC20, "Approval")
          .withArgs(buyer.address, marketplaceContract.address, tokenAmount);

        await withBalanceChecks([order], 0, [], async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ],
            null,
            []
          );
          return receipt;
        });

        orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(true);
        expect(orderStatus.totalFilled).to.equal(1);
        expect(orderStatus.totalSize).to.equal(1);
      });
      it("Reverts when 1155 token transfer reverts", async () => {
        // Seller mints nft
        const nftId = ethers.BigNumber.from(randomHex());
        const amount = ethers.BigNumber.from(randomHex().slice(0, 5));
        await testERC1155.mint(seller.address, nftId, amount.mul(10000));

        const offer = [getTestItem1155(nftId, amount.mul(10), amount.mul(10))];

        const consideration = [getItemETH(10, 10, seller.address)];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value,
            })
        ).to.be.revertedWith("NOT_AUTHORIZED");
      });
      it("Reverts when 1155 token transfer reverts (via conduit)", async () => {
        // Seller mints nft
        const nftId = ethers.BigNumber.from(randomHex());
        const amount = ethers.BigNumber.from(randomHex().slice(0, 5));
        await testERC1155.mint(seller.address, nftId, amount.mul(10000));

        const offer = [getTestItem1155(nftId, amount.mul(10), amount.mul(10))];

        const consideration = [getItemETH(10, 10, seller.address)];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0, // FULL_OPEN
          [],
          null,
          seller,
          constants.HashZero,
          conduitKeyOne
        );

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value,
            })
        ).to.be.revertedWith(`NOT_AUTHORIZED`);
      });

      // Skip this test when testing the reference contract
      if (!process.env.REFERENCE) {
        it("Reverts when 1155 token transfer reverts (via conduit, returndata)", async () => {
          const recipient = await (
            await ethers.getContractFactory("ExcessReturnDataRecipient")
          ).deploy();

          const setup = async () => {
            // seller mints ERC20
            const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);
            await testERC20.mint(seller.address, tokenAmount);

            // Seller approves conduit contract to transfer tokens
            await expect(
              testERC20.connect(seller).approve(conduitOne.address, tokenAmount)
            )
              .to.emit(testERC20, "Approval")
              .withArgs(seller.address, conduitOne.address, tokenAmount);

            // Buyer mints nft
            const nftId = ethers.BigNumber.from(randomHex());
            const amount = ethers.BigNumber.from(randomHex().slice(0, 5));
            await testERC1155.mint(buyer.address, nftId, amount.mul(10000));

            // Buyer approves conduit contract to transfer NFTs
            await expect(
              testERC1155
                .connect(buyer)
                .setApprovalForAll(conduitOne.address, true)
            )
              .to.emit(testERC1155, "ApprovalForAll")
              .withArgs(buyer.address, conduitOne.address, true);

            const offer = [getTestItem20(tokenAmount, tokenAmount)];

            const consideration = [
              getTestItem1155(
                nftId,
                amount.mul(10),
                amount.mul(10),
                undefined,
                recipient.address
              ),
            ];

            const { order, value } = await createOrder(
              seller,
              zone,
              offer,
              consideration,
              0, // FULL_OPEN
              [],
              null,
              seller,
              constants.HashZero,
              conduitKeyOne
            );

            return {
              order,
              value,
            };
          };

          const { order: initialOrder, value } = await setup();
          const baseGas = await marketplaceContract
            .connect(buyer)
            .estimateGas.fulfillAdvancedOrder(initialOrder, [], conduitKeyOne, {
              value,
            });

          // TODO: clean *this* up
          const { order } = await setup();
          await recipient.setRevertDataSize(1);
          await expect(
            marketplaceContract
              .connect(buyer)
              .fulfillAdvancedOrder(order, [], conduitKeyOne, {
                value,
                gasLimit: hre.__SOLIDITY_COVERAGE_RUNNING
                  ? baseGas.add(35000)
                  : baseGas.add(2000),
              })
          ).to.be.revertedWith("InvalidCallToConduit");
        });
      }

      it("Reverts when transferred item amount is zero", async () => {
        // Seller mints nft
        const { nftId, amount } = await mintAndApprove1155(
          seller,
          marketplaceContract.address,
          10000
        );

        // Buyer mints ERC20
        const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);
        await testERC20.mint(buyer.address, tokenAmount);

        // Buyer approves marketplace contract to transfer tokens

        await expect(
          testERC20
            .connect(buyer)
            .approve(marketplaceContract.address, tokenAmount)
        )
          .to.emit(testERC20, "Approval")
          .withArgs(buyer.address, marketplaceContract.address, tokenAmount);

        const offer = [getTestItem1155(nftId, 0, 0, undefined)];

        const consideration = [
          getTestItem20(amount.mul(1000), amount.mul(1000), seller.address),
          getTestItem20(amount.mul(10), amount.mul(10), zone.address),
          getTestItem20(amount.mul(20), amount.mul(20), owner.address),
        ];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value,
            })
        ).to.be.revertedWith("MissingItemAmount");
      });
      it("Reverts when ERC20 tokens return falsey values", async () => {
        // Seller mints nft
        const { nftId, amount } = await mintAndApprove1155(
          seller,
          marketplaceContract.address,
          10000
        );

        // Buyer mints ERC20
        const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);
        await testERC20.mint(buyer.address, tokenAmount);

        // Buyer approves marketplace contract to transfer tokens

        await expect(
          testERC20
            .connect(buyer)
            .approve(marketplaceContract.address, tokenAmount)
        )
          .to.emit(testERC20, "Approval")
          .withArgs(buyer.address, marketplaceContract.address, tokenAmount);

        const offer = [getTestItem1155(nftId, amount.mul(10), amount.mul(10))];

        const consideration = [
          getTestItem20(amount.mul(1000), amount.mul(1000), seller.address),
          getTestItem20(amount.mul(10), amount.mul(10), zone.address),
          getTestItem20(amount.mul(20), amount.mul(20), owner.address),
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        // block transfers
        await testERC20.blockTransfer(true);

        expect(await testERC20.blocked()).to.be.true;

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value,
            })
        ).to.be.reverted; // TODO: hardhat can't find error msg on IR pipeline

        let orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(false);
        expect(orderStatus.totalFilled).to.equal(0);
        expect(orderStatus.totalSize).to.equal(0);

        await testERC20.blockTransfer(false);

        expect(await testERC20.blocked()).to.be.false;

        await withBalanceChecks([order], 0, [], async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ],
            null,
            []
          );
          return receipt;
        });

        orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(true);
        expect(orderStatus.totalFilled).to.equal(1);
        expect(orderStatus.totalSize).to.equal(1);
      });
      it("Works when ERC20 tokens return falsey values", async () => {
        // Seller mints nft
        const { nftId, amount } = await mintAndApprove1155(
          seller,
          marketplaceContract.address,
          10000
        );

        // Buyer mints ERC20
        const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);
        await testERC20.mint(buyer.address, tokenAmount);

        // Buyer approves marketplace contract to transfer tokens

        await expect(
          testERC20
            .connect(buyer)
            .approve(marketplaceContract.address, tokenAmount)
        )
          .to.emit(testERC20, "Approval")
          .withArgs(buyer.address, marketplaceContract.address, tokenAmount);

        const offer = [getTestItem1155(nftId, amount.mul(10), amount.mul(10))];

        const consideration = [
          getTestItem20(amount.mul(1000), amount.mul(1000), seller.address),
          getTestItem20(amount.mul(10), amount.mul(10), zone.address),
          getTestItem20(amount.mul(20), amount.mul(20), owner.address),
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        await testERC20.setNoReturnData(true);

        expect(await testERC20.noReturnData()).to.be.true;

        await withBalanceChecks([order], 0, [], async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ],
            null,
            []
          );
          return receipt;
        });

        const orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(true);
        expect(orderStatus.totalFilled).to.equal(1);
        expect(orderStatus.totalSize).to.equal(1);

        await testERC20.setNoReturnData(false);

        expect(await testERC20.noReturnData()).to.be.false;
      });
      it("Reverts when ERC20 tokens return falsey values (via conduit)", async () => {
        // Seller mints nft
        const nftId = ethers.BigNumber.from(randomHex());
        const amount = ethers.BigNumber.from(randomHex().slice(0, 5));
        await testERC1155.mint(seller.address, nftId, amount.mul(10000));

        // Seller approves conduit contract to transfer NFTs
        await set1155ApprovalForAll(seller, conduitOne.address, true);

        // Buyer mints ERC20
        const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);
        await testERC20.mint(buyer.address, tokenAmount);

        // Buyer approves conduit contract to transfer tokens

        await expect(
          testERC20.connect(buyer).approve(conduitOne.address, tokenAmount)
        )
          .to.emit(testERC20, "Approval")
          .withArgs(buyer.address, conduitOne.address, tokenAmount);

        // Seller approves conduit contract to transfer tokens
        await expect(
          testERC20.connect(seller).approve(conduitOne.address, tokenAmount)
        )
          .to.emit(testERC20, "Approval")
          .withArgs(seller.address, conduitOne.address, tokenAmount);

        const offer = [getTestItem1155(nftId, amount.mul(10), amount.mul(10))];

        const consideration = [
          getTestItem20(amount.mul(1000), amount.mul(1000), seller.address),
          getTestItem20(amount.mul(10), amount.mul(10), zone.address),
          getTestItem20(amount.mul(20), amount.mul(20), owner.address),
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0, // FULL_OPEN
          [],
          null,
          seller,
          constants.HashZero,
          conduitKeyOne
        );

        // block transfers
        await testERC20.blockTransfer(true);

        if (!process.env.REFERENCE) {
          await expect(
            marketplaceContract
              .connect(buyer)
              .fulfillAdvancedOrder(order, [], conduitKeyOne, {
                value,
              })
          ).to.be.revertedWith(
            `BadReturnValueFromERC20OnTransfer("${testERC20.address}", "${
              buyer.address
            }", "${seller.address}", ${amount.mul(1000).toString()})`
          );
        } else {
          await expect(
            marketplaceContract
              .connect(buyer)
              .fulfillAdvancedOrder(order, [], conduitKeyOne, {
                value,
              })
          ).to.be.reverted;
        }

        let orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(false);
        expect(orderStatus.totalFilled).to.equal(0);
        expect(orderStatus.totalSize).to.equal(0);

        await testERC20.blockTransfer(false);

        await withBalanceChecks([order], 0, [], async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], conduitKeyOne, {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ],
            null,
            []
          );
          return receipt;
        });

        orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(true);
        expect(orderStatus.totalFilled).to.equal(1);
        expect(orderStatus.totalSize).to.equal(1);
      });
      it("Reverts when providing non-existent conduit", async () => {
        // Seller mints nft
        const nftId = ethers.BigNumber.from(randomHex());
        const amount = ethers.BigNumber.from(randomHex().slice(0, 5));
        await testERC1155.mint(seller.address, nftId, amount.mul(10000));

        // Seller approves conduit contract to transfer NFTs
        await set1155ApprovalForAll(seller, conduitOne.address, true);

        // Buyer mints ERC20
        const tokenAmount = ethers.BigNumber.from(randomLarge()).add(100);
        await testERC20.mint(buyer.address, tokenAmount);

        // Buyer approves conduit contract to transfer tokens
        await expect(
          testERC20.connect(buyer).approve(conduitOne.address, tokenAmount)
        )
          .to.emit(testERC20, "Approval")
          .withArgs(buyer.address, conduitOne.address, tokenAmount);

        // Seller approves conduit contract to transfer tokens
        await expect(
          testERC20.connect(seller).approve(conduitOne.address, tokenAmount)
        )
          .to.emit(testERC20, "Approval")
          .withArgs(seller.address, conduitOne.address, tokenAmount);

        const offer = [getTestItem1155(nftId, amount.mul(10), amount.mul(10))];

        const consideration = [
          getTestItem20(amount.mul(1000), amount.mul(1000), seller.address),
          getTestItem20(amount.mul(10), amount.mul(10), zone.address),
          getTestItem20(amount.mul(20), amount.mul(20), owner.address),
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0, // FULL_OPEN
          [],
          null,
          seller,
          constants.HashZero,
          conduitKeyOne
        );

        const badKey = ethers.constants.HashZero.slice(0, -1) + "2";

        const missingConduit = await conduitController.getConduit(badKey);

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], badKey, {
              value,
            })
        ).to.be.revertedWith("InvalidConduit", badKey, missingConduit);

        let orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(false);
        expect(orderStatus.totalFilled).to.equal(0);
        expect(orderStatus.totalSize).to.equal(0);

        await withBalanceChecks([order], 0, [], async () => {
          const tx = await marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], conduitKeyOne, {
              value,
            });
          const receipt = await tx.wait();
          await checkExpectedEvents(
            receipt,
            [
              {
                order,
                orderHash,
                fulfiller: buyer.address,
              },
            ],
            null,
            []
          );
          return receipt;
        });

        orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(true);
        expect(orderStatus.totalFilled).to.equal(1);
        expect(orderStatus.totalSize).to.equal(1);
      });
      it("Reverts when 1155 tokens are not approved", async () => {
        // Seller mints first nft
        const { nftId, amount } = await mint1155(seller);

        // Seller mints second nft
        const { nftId: secondNftId, amount: secondAmount } = await mint1155(
          seller
        );

        const offer = [
          getTestItem1155(nftId, 0, 0),
          getTestItem1155(secondNftId, secondAmount, secondAmount),
        ];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const { mirrorOrder } = await createMirrorBuyNowOrder(
          buyer,
          zone,
          order
        );

        const fulfillments = [
          [[[0, 0]], [[1, 0]]],
          [[[0, 1]], [[1, 1]]],
          [[[1, 0]], [[0, 0]]],
          [[[1, 0]], [[0, 1]]],
          [[[1, 0]], [[0, 2]]],
        ].map(([offerArr, considerationArr]) =>
          toFulfillment(offerArr, considerationArr)
        );

        await expect(
          marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments, {
              value,
            })
        ).to.be.revertedWith("MissingItemAmount");
      });
      it("Reverts when 1155 tokens are not approved", async () => {
        // Seller mints first nft
        const { nftId, amount } = await mint1155(seller);

        // Seller mints second nft
        const { nftId: secondNftId, amount: secondAmount } = await mint1155(
          seller
        );

        const offer = [
          getTestItem1155(nftId, amount, amount, undefined),
          getTestItem1155(secondNftId, secondAmount, secondAmount),
        ];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const { mirrorOrder, mirrorOrderHash } = await createMirrorBuyNowOrder(
          buyer,
          zone,
          order
        );

        const fulfillments = [
          [[[0, 0]], [[1, 0]]],
          [[[0, 1]], [[1, 1]]],
          [[[1, 0]], [[0, 0]]],
          [[[1, 0]], [[0, 1]]],
          [[[1, 0]], [[0, 2]]],
        ].map(([offerArr, considerationArr]) =>
          toFulfillment(offerArr, considerationArr)
        );

        await expect(
          marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments, {
              value,
            })
        ).to.be.revertedWith("NOT_AUTHORIZED");

        const orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(false);
        expect(orderStatus.totalFilled).to.equal(0);
        expect(orderStatus.totalSize).to.equal(0);

        // Seller approves marketplace contract to transfer NFT

        await set1155ApprovalForAll(seller, marketplaceContract.address, true);

        const executions = await simulateMatchOrders(
          [order, mirrorOrder],
          fulfillments,
          owner,
          value
        );

        expect(executions.length).to.equal(5);

        const tx = await marketplaceContract
          .connect(owner)
          .matchOrders([order, mirrorOrder], fulfillments, {
            value,
          });
        const receipt = await tx.wait();
        await checkExpectedEvents(
          receipt,
          [
            {
              order,
              orderHash,
              fulfiller: constants.AddressZero,
            },
          ],
          executions
        );
        await checkExpectedEvents(
          receipt,
          [
            {
              order: mirrorOrder,
              orderHash: mirrorOrderHash,
              fulfiller: constants.AddressZero,
            },
          ],
          executions
        );
        return receipt;
      });
      it("Reverts when token account with no code is supplied", async () => {
        // Seller mints nft
        const nftId = ethers.BigNumber.from(randomHex());
        const amount = ethers.BigNumber.from(randomHex().slice(0, 5));
        await testERC1155.mint(seller.address, nftId, amount);

        // Seller approves marketplace contract to transfer NFTs

        await set1155ApprovalForAll(seller, marketplaceContract.address, true);

        const offer = [getTestItem1155(nftId, amount, amount, undefined)];

        const consideration = [
          getTestItem20(
            amount,
            amount,
            seller.address,
            ethers.constants.AddressZero
          ),
        ];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value,
            })
        ).to.be.reverted; // TODO: look into the revert reason more thoroughly
        // Transaction reverted: function returned an unexpected amount of data
      });
      it("Reverts when 721 account with no code is supplied", async () => {
        const offer = [
          {
            itemType: 2, // ERC721
            token: buyer.address,
            identifierOrCriteria: 0,
            startAmount: 1,
            endAmount: 1,
          },
        ];

        const consideration = [getItemETH(10, 10, seller.address)];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), { value })
        ).to.be.revertedWith(`NoContract("${buyer.address}")`);
      });
      it("Reverts when 1155 account with no code is supplied", async () => {
        const amount = ethers.BigNumber.from(randomHex().slice(0, 5));

        const offer = [
          getTestItem1155(0, amount, amount, ethers.constants.AddressZero),
        ];

        const consideration = [getItemETH(10, 10, seller.address)];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value,
            })
        ).to.be.revertedWith(`NoContract("${ethers.constants.AddressZero}")`);
      });
      it("Reverts when 1155 account with no code is supplied (via conduit)", async () => {
        const amount = ethers.BigNumber.from(randomHex().slice(0, 5));

        const offer = [
          getTestItem1155(0, amount, amount, ethers.constants.AddressZero),
        ];

        const consideration = [getItemETH(10, 10, seller.address)];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0, // FULL_OPEN
          [],
          null,
          seller,
          constants.HashZero,
          conduitKeyOne
        );

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value,
            })
        ).to.be.revertedWith(`NoContract("${ethers.constants.AddressZero}")`);
      });
      it("Reverts when non-token account is supplied as the token", async () => {
        // Seller mints nft
        const nftId = ethers.BigNumber.from(randomHex());
        const amount = ethers.BigNumber.from(randomHex().slice(0, 5));
        await testERC1155.mint(seller.address, nftId, amount);

        // Seller approves marketplace contract to transfer NFTs

        await set1155ApprovalForAll(seller, marketplaceContract.address, true);

        const offer = [getTestItem1155(nftId, amount, amount, undefined)];

        const consideration = [
          getTestItem20(
            amount,
            amount,
            seller.address,
            marketplaceContract.address
          ),
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], toKey(false), {
              value,
            })
        ).to.be.revertedWith(
          `TokenTransferGenericFailure("${marketplaceContract.address}", "${
            buyer.address
          }", "${seller.address}", 0, ${amount.toString()})`
        );
      });
      it("Reverts when non-token account is supplied as the token fulfilled via conduit", async () => {
        // Seller mints nft
        const nftId = ethers.BigNumber.from(randomHex());
        const amount = ethers.BigNumber.from(randomHex().slice(0, 5));
        await testERC1155.mint(seller.address, nftId, amount);

        // Seller approves marketplace contract to transfer NFTs

        await set1155ApprovalForAll(seller, marketplaceContract.address, true);

        const offer = [getTestItem1155(nftId, amount, amount, undefined)];

        const consideration = [
          getTestItem20(
            amount,
            amount,
            seller.address,
            marketplaceContract.address
          ),
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillAdvancedOrder(order, [], conduitKeyOne, {
              value,
            })
        ).to.be.revertedWith(
          `TokenTransferGenericFailure("${marketplaceContract.address}", "${
            buyer.address
          }", "${seller.address}", 0, ${amount.toString()})`
        );
      });
      it("Reverts when non-1155 account is supplied as the token", async () => {
        const amount = ethers.BigNumber.from(randomHex().slice(0, 5));

        const offer = [
          getTestItem1155(0, amount, amount, marketplaceContract.address),
        ];

        const consideration = [getItemETH(10, 10, seller.address)];

        const { order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        if (!process.env.REFERENCE) {
          await expect(
            marketplaceContract
              .connect(buyer)
              .fulfillAdvancedOrder(order, [], toKey(false), {
                value,
              })
          ).to.be.revertedWith(
            `TokenTransferGenericFailure("${marketplaceContract.address}", "${
              seller.address
            }", "${buyer.address}", 0, ${amount.toString()})`
          );
        } else {
          await expect(
            marketplaceContract
              .connect(buyer)
              .fulfillAdvancedOrder(order, [], toKey(false), {
                value,
              })
          ).to.be.reverted;
        }
      });
      it("Reverts when 1155 token is not approved via conduit", async () => {
        // Seller mints first nft
        const { nftId, amount } = await mint1155(seller);

        // Seller mints second nft
        const { nftId: secondNftId, amount: secondAmount } = await mint1155(
          seller
        );

        const offer = [
          getTestItem1155(nftId, amount, amount, testERC1155.address),
          getTestItem1155(
            secondNftId,
            secondAmount,
            secondAmount,
            testERC1155.address
          ),
        ];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0, // FULL_OPEN
          [],
          null,
          seller,
          constants.HashZero,
          conduitKeyOne
        );

        const { mirrorOrder } = await createMirrorBuyNowOrder(
          buyer,
          zone,
          order
        );

        const fulfillments = [
          [[[0, 0]], [[1, 0]]],
          [[[0, 1]], [[1, 1]]],
          [[[1, 0]], [[0, 0]]],
          [[[1, 0]], [[0, 1]]],
          [[[1, 0]], [[0, 2]]],
        ].map(([offerArr, considerationArr]) =>
          toFulfillment(offerArr, considerationArr)
        );

        await expect(
          marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments, {
              value,
            })
        ).to.be.revertedWith("NOT_AUTHORIZED");

        const orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(false);
        expect(orderStatus.totalFilled).to.equal(0);
        expect(orderStatus.totalSize).to.equal(0);
      });
      it("Reverts when 1155 token with no code is supplied as the token via conduit", async () => {
        // Seller mints first nft
        const nftId = ethers.BigNumber.from(randomHex().slice(0, 10));
        const amount = ethers.BigNumber.from(randomHex().slice(0, 10));

        // Seller mints second nft
        const secondNftId = ethers.BigNumber.from(randomHex().slice(0, 10));
        const secondAmount = ethers.BigNumber.from(randomHex().slice(0, 10));

        const offer = [
          getTestItem1155(nftId, amount, amount, ethers.constants.AddressZero),
          getTestItem1155(
            secondNftId,
            secondAmount,
            secondAmount,
            ethers.constants.AddressZero
          ),
        ];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, zone.address),
          getItemETH(1, 1, owner.address),
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0, // FULL_OPEN
          [],
          null,
          seller,
          constants.HashZero,
          conduitKeyOne
        );

        const { mirrorOrder } = await createMirrorBuyNowOrder(
          buyer,
          zone,
          order
        );

        const fulfillments = [
          [[[0, 0]], [[1, 0]]],
          [[[0, 1]], [[1, 1]]],
          [[[1, 0]], [[0, 0]]],
          [[[1, 0]], [[0, 1]]],
          [[[1, 0]], [[0, 2]]],
        ].map(([offerArr, considerationArr]) =>
          toFulfillment(offerArr, considerationArr)
        );

        await expect(
          marketplaceContract
            .connect(owner)
            .matchOrders([order, mirrorOrder], fulfillments, {
              value,
            })
        ).to.be.revertedWith("NoContract", ethers.constants.AddressZero);

        const orderStatus = await marketplaceContract.getOrderStatus(orderHash);

        expect(orderStatus.isCancelled).to.equal(false);
        expect(orderStatus.isValidated).to.equal(false);
        expect(orderStatus.totalFilled).to.equal(0);
        expect(orderStatus.totalSize).to.equal(0);
      });
      it("Reverts when non-payable ether recipient is supplied", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          {
            itemType: 0, // ETH
            token: constants.AddressZero,
            identifierOrCriteria: 0, // ignored for ETH
            startAmount: ethers.utils.parseEther("1"),
            endAmount: ethers.utils.parseEther("1"),
            recipient: marketplaceContract.address,
          },
          getItemETH(1, 1, owner.address),
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        const basicOrderParameters = getBasicOrderParameters(
          0, // EthForERC721
          order
        );

        await expect(
          marketplaceContract
            .connect(buyer)
            .fulfillBasicOrder(basicOrderParameters, {
              value,
            })
        ).to.be.revertedWith(
          `EtherTransferGenericFailure("${
            marketplaceContract.address
          }", ${ethers.utils.parseEther("1").toString()})`
        );
      });
    });

    describe("Basic Order Calldata", () => {
      let calldata, value;

      before(async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [getItemETH(10, 10, seller.address)];
        let order;
        ({ order, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        ));

        const basicOrderParameters = getBasicOrderParameters(
          0, // EthForERC721
          order
        );

        ({ data: calldata } =
          await marketplaceContract.populateTransaction.fulfillBasicOrder(
            basicOrderParameters
          ));
      });

      it("Reverts if BasicOrderParameters has non-default offset", async () => {
        const badData = [calldata.slice(0, 73), "1", calldata.slice(74)].join(
          ""
        );
        expect(badData.length).to.eq(calldata.length);

        await expect(
          buyer.sendTransaction({
            to: marketplaceContract.address,
            data: badData,
            value,
          })
        ).to.be.revertedWith("InvalidBasicOrderParameterEncoding");
      });

      it("Reverts if additionalRecipients has non-default offset", async () => {
        const badData = [
          calldata.slice(0, 1161),
          "1",
          calldata.slice(1162),
        ].join("");

        await expect(
          buyer.sendTransaction({
            to: marketplaceContract.address,
            data: badData,
            value,
          })
        ).to.be.revertedWith("InvalidBasicOrderParameterEncoding");
      });

      it("Reverts if signature has non-default offset", async () => {
        const badData = [
          calldata.slice(0, 1161),
          "2",
          calldata.slice(1162),
        ].join("");

        await expect(
          buyer.sendTransaction({
            to: marketplaceContract.address,
            data: badData,
            value,
          })
        ).to.be.revertedWith("InvalidBasicOrderParameterEncoding");
      });
    });

    describe("Reentrancy", async () => {
      it("Reverts on a reentrant call", async () => {
        // Seller mints nft
        const nftId = await mintAndApprove721(
          seller,
          marketplaceContract.address
        );

        const offer = [getTestItem721(nftId)];

        const consideration = [
          getItemETH(10, 10, seller.address),
          getItemETH(1, 1, reenterer.address),
        ];

        const { order, orderHash, value } = await createOrder(
          seller,
          zone,
          offer,
          consideration,
          0 // FULL_OPEN
        );

        // prepare the reentrant call on the reenterer
        const callData = marketplaceContract.interface.encodeFunctionData(
          "fulfillOrder",
          [order, toKey(false)]
        );
        const tx = await reenterer.prepare(
          marketplaceContract.address,
          0,
          callData
        );
        await tx.wait();

        if (!process.env.REFERENCE) {
          await expect(
            marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, toKey(false), {
                value,
              })
          ).to.be.revertedWith("NoReentrantCalls");
        } else {
          await expect(
            marketplaceContract
              .connect(buyer)
              .fulfillOrder(order, toKey(false), {
                value,
              })
          ).to.be.reverted;
        }
      });
      it.skip("Reverts on reentrancy (test all the other permutations)", async () => {});
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
