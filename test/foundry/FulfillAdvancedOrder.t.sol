// SPDX-License-Identifier: MIT

pragma solidity 0.8.13;

import { OrderType, BasicOrderType, ItemType, Side } from "../../contracts/lib/ConsiderationEnums.sol";
import { AdditionalRecipient } from "../../contracts/lib/ConsiderationStructs.sol";
import { Consideration } from "../../contracts/Consideration.sol";
import { Order, OfferItem, OrderParameters, ConsiderationItem, OrderComponents, BasicOrderParameters } from "../../contracts/lib/ConsiderationStructs.sol";
import { BaseOrderTest } from "./utils/BaseOrderTest.sol";
import { TestERC721 } from "../../contracts/test/TestERC721.sol";
import { TestERC1155 } from "../../contracts/test/TestERC1155.sol";
import { TestERC20 } from "../../contracts/test/TestERC20.sol";
import { ProxyRegistry } from "./interfaces/ProxyRegistry.sol";
import { OwnableDelegateProxy } from "./interfaces/OwnableDelegateProxy.sol";

contract FulfillAdvancedOrder is BaseOrderTest {
    struct AdvancedOrderInputs {
        uint256 tokenId;
        address zone;
        bytes32 zoneHash;
        uint256 salt;
        uint128[3] ethAmts;
        bool useConduit;
    }

    struct TestAdvancedOrder {
        Consideration consideration;
        AdvancedOrderInputs args;
    }

    /**
     * TODO: actually test advanced :)
     */
    function testAdvancedSingleERC721(AdvancedOrderInputs memory args) public {
        _advancedSingleERC721(TestAdvancedOrder(consideration, args));
        _advancedSingleERC721(TestAdvancedOrder(referenceConsideration, args));
    }

    function _advancedSingleERC721(TestAdvancedOrder memory testAdvancedOrder)
        internal
        onlyPayable(testAdvancedOrder.args.zone)
        topUp
        resetTokenBalancesBetweenRuns
    {
        vm.assume(
            testAdvancedOrder.args.ethAmts[0] > 0 &&
                testAdvancedOrder.args.ethAmts[1] > 0 &&
                testAdvancedOrder.args.ethAmts[2] > 0
        );
        vm.assume(
            uint256(testAdvancedOrder.args.ethAmts[0]) +
                uint256(testAdvancedOrder.args.ethAmts[1]) +
                uint256(testAdvancedOrder.args.ethAmts[2]) <=
                2**128 - 1
        );

        // require(testAdvancedOrder.args.salt != 5, "bad");
        bytes32 conduitKey = testAdvancedOrder.args.useConduit
            ? conduitKeyOne
            : bytes32(0);

        test721_1.mint(alice, testAdvancedOrder.args.tokenId);
        OfferItem[] memory offerItem = singleOfferItem(
            ItemType.ERC721,
            address(test721_1),
            testAdvancedOrder.args.tokenId,
            1,
            1
        );
        considerationItems = new ConsiderationItem[](3);
        considerationItems[0] = ConsiderationItem(
            ItemType.NATIVE,
            address(0),
            0,
            uint256(testAdvancedOrder.args.ethAmts[0]),
            uint256(testAdvancedOrder.args.ethAmts[0]),
            payable(alice)
        );
        considerationItems[1] = ConsiderationItem(
            ItemType.NATIVE,
            address(0),
            0,
            uint256(testAdvancedOrder.args.ethAmts[1]),
            uint256(testAdvancedOrder.args.ethAmts[1]),
            payable(testAdvancedOrder.args.zone) // TODO: should we fuzz on zone? do royalties get paid to zone??
        );
        considerationItems[2] = ConsiderationItem(
            ItemType.NATIVE,
            address(0),
            0,
            uint256(testAdvancedOrder.args.ethAmts[2]),
            uint256(testAdvancedOrder.args.ethAmts[2]),
            payable(cal)
        );

        OrderComponents memory orderComponents = OrderComponents(
            alice,
            testAdvancedOrder.args.zone,
            offerItem,
            considerationItems,
            OrderType.FULL_OPEN,
            block.timestamp,
            block.timestamp + 1,
            testAdvancedOrder.args.zoneHash,
            testAdvancedOrder.args.salt,
            conduitKey,
            testAdvancedOrder.consideration.getNonce(alice)
        );
        bytes memory signature = signOrder(
            testAdvancedOrder.consideration,
            alicePk,
            testAdvancedOrder.consideration.getOrderHash(orderComponents)
        );
        OrderParameters memory orderParameters = OrderParameters(
            address(alice),
            testAdvancedOrder.args.zone,
            offerItem,
            considerationItems,
            OrderType.FULL_OPEN,
            block.timestamp,
            block.timestamp + 1,
            testAdvancedOrder.args.zoneHash,
            testAdvancedOrder.args.salt,
            conduitKey,
            considerationItems.length
        );
        testAdvancedOrder.consideration.fulfillOrder{
            value: testAdvancedOrder.args.ethAmts[0] +
                testAdvancedOrder.args.ethAmts[1] +
                testAdvancedOrder.args.ethAmts[2]
        }(Order(orderParameters, signature), conduitKey);
        emit log_named_uint(
            "ending balance of this",
            test721_1.balanceOf(address(this))
        );
    }
}
