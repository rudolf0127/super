// SPDX-License-Identifier: MIT

pragma solidity 0.8.13;

import { OrderType, BasicOrderType, ItemType, Side } from "../../contracts/lib/ConsiderationEnums.sol";
import { Order, Fulfillment } from "../../contracts/lib/ConsiderationStructs.sol";
import { ConsiderationInterface } from "../../contracts/interfaces/ConsiderationInterface.sol";
import { AdvancedOrder, OfferItem, OrderParameters, ConsiderationItem, OrderComponents, BasicOrderParameters, CriteriaResolver, FulfillmentComponent } from "../../contracts/lib/ConsiderationStructs.sol";
import { BaseOrderTest } from "./utils/BaseOrderTest.sol";
import { TestERC721 } from "../../contracts/test/TestERC721.sol";
import { TestERC1155 } from "../../contracts/test/TestERC1155.sol";
import { TestERC20 } from "../../contracts/test/TestERC20.sol";
import { ProxyRegistry } from "./interfaces/ProxyRegistry.sol";
import { OwnableDelegateProxy } from "./interfaces/OwnableDelegateProxy.sol";
import { Merkle } from "../../lib/murky/src/Merkle.sol";
import { stdError } from "forge-std/Test.sol";

contract MatchAdvancedOrder is BaseOrderTest {
    struct FuzzInputs {
        address zone;
        uint256 id;
        bytes32 zoneHash;
        uint256 salt;
        uint128 amount;
        bool useConduit;
    }

    struct Context {
        ConsiderationInterface consideration;
        FuzzInputs args;
    }

    function testMatchAdvancedOrdersOverflowOrderSide() public {
        // start at 1 to skip eth
        for (uint256 i = 1; i < 4; i++) {
            // skip 721s
            if (i == 2) {
                continue;
            }
            _testMatchAdvancedOrdersOverflowOrderSide(
                consideration,
                ItemType(i)
            );
            _testMatchAdvancedOrdersOverflowOrderSide(
                referenceConsideration,
                ItemType(i)
            );
        }
    }

    function testMatchAdvancedOrdersOverflowConsiderationSide() public {
        // start at 1 to skip eth
        for (uint256 i = 1; i < 4; i++) {
            // skip 721s
            if (i == 2) {
                continue;
            }
            _testMatchAdvancedOrdersOverflowConsiderationSide(
                consideration,
                ItemType(i)
            );
            _testMatchAdvancedOrdersOverflowConsiderationSide(
                referenceConsideration,
                ItemType(i)
            );
        }
    }

    function testMatchAdvancedOrdersWithEmptyCriteriaEthToErc721(
        FuzzInputs memory args
    ) public {
        _testMatchAdvancedOrdersWithEmptyCriteriaEthToErc721(
            Context(referenceConsideration, args)
        );
        _testMatchAdvancedOrdersWithEmptyCriteriaEthToErc721(
            Context(consideration, args)
        );
    }

    function _testMatchAdvancedOrdersOverflowOrderSide(
        ConsiderationInterface _consideration,
        ItemType itemType
    ) internal resetTokenBalancesBetweenRuns {
        _configureOfferItem(itemType, 1, 100);
        _configureErc721ConsiderationItem(alice, 1);

        OrderParameters memory firstOrderParameters = OrderParameters(
            address(bob),
            address(0),
            offerItems,
            considerationItems,
            OrderType.FULL_OPEN,
            block.timestamp,
            block.timestamp + 1,
            bytes32(0),
            0,
            bytes32(0),
            considerationItems.length
        );

        OrderComponents memory firstOrderComponents = getOrderComponents(
            firstOrderParameters,
            _consideration.getNonce(bob)
        );
        bytes memory firstSignature = signOrder(
            _consideration,
            bobPk,
            _consideration.getOrderHash(firstOrderComponents)
        );

        delete offerItems;
        delete considerationItems;

        _configureOfferItem(itemType, 1, 2**256 - 1);
        _configureErc721ConsiderationItem(alice, 2);

        OrderParameters memory secondOrderParameters = OrderParameters(
            address(bob),
            address(0),
            offerItems,
            considerationItems,
            OrderType.FULL_OPEN,
            block.timestamp,
            block.timestamp + 1,
            bytes32(0),
            0,
            bytes32(0),
            considerationItems.length
        );

        OrderComponents memory secondOrderComponents = getOrderComponents(
            secondOrderParameters,
            _consideration.getNonce(bob)
        );
        bytes memory secondSignature = signOrder(
            _consideration,
            bobPk,
            _consideration.getOrderHash(secondOrderComponents)
        );

        delete offerItems;
        delete considerationItems;

        test721_1.mint(alice, 1);
        test721_1.mint(alice, 2);
        _configureERC721OfferItem(1);
        _configureERC721OfferItem(2);
        _configureConsiderationItem(bob, itemType, 1, 99);

        OrderParameters memory thirdOrderParameters = OrderParameters(
            address(alice),
            address(0),
            offerItems,
            considerationItems,
            OrderType.FULL_OPEN,
            block.timestamp,
            block.timestamp + 1,
            bytes32(0),
            0,
            bytes32(0),
            considerationItems.length
        );

        OrderComponents memory thirdOrderComponents = getOrderComponents(
            thirdOrderParameters,
            _consideration.getNonce(alice)
        );

        bytes memory thirdSignature = signOrder(
            _consideration,
            alicePk,
            _consideration.getOrderHash(thirdOrderComponents)
        );

        delete offerItems;
        delete considerationItems;

        AdvancedOrder[] memory advancedOrders = new AdvancedOrder[](3);
        advancedOrders[0] = AdvancedOrder(
            firstOrderParameters,
            uint120(1),
            uint120(1),
            firstSignature,
            "0x"
        );
        advancedOrders[1] = AdvancedOrder(
            secondOrderParameters,
            uint120(1),
            uint120(1),
            secondSignature,
            "0x"
        );
        advancedOrders[2] = AdvancedOrder(
            thirdOrderParameters,
            uint120(1),
            uint120(1),
            thirdSignature,
            "0x"
        );

        fulfillmentComponent = FulfillmentComponent(2, 0);
        fulfillmentComponents.push(fulfillmentComponent);
        fulfillment.offerComponents = fulfillmentComponents;
        delete fulfillmentComponents;
        fulfillmentComponent = FulfillmentComponent(0, 0);
        fulfillmentComponents.push(fulfillmentComponent);
        fulfillment.considerationComponents = fulfillmentComponents;
        fulfillments.push(fulfillment);
        delete fulfillmentComponents;
        delete fulfillment;

        fulfillmentComponent = FulfillmentComponent(2, 1);
        fulfillmentComponents.push(fulfillmentComponent);
        fulfillment.offerComponents = fulfillmentComponents;
        delete fulfillmentComponents;
        fulfillmentComponent = FulfillmentComponent(1, 0);
        fulfillmentComponents.push(fulfillmentComponent);
        fulfillment.considerationComponents = fulfillmentComponents;
        fulfillments.push(fulfillment);
        delete fulfillmentComponents;
        delete fulfillment;

        fulfillmentComponent = FulfillmentComponent(0, 0);
        fulfillmentComponents.push(fulfillmentComponent);
        fulfillmentComponent = FulfillmentComponent(1, 0);
        fulfillmentComponents.push(fulfillmentComponent);
        fulfillment.offerComponents = fulfillmentComponents;
        delete fulfillmentComponents;
        fulfillmentComponent = FulfillmentComponent(2, 0);
        fulfillmentComponents.push(fulfillmentComponent);
        fulfillment.considerationComponents = fulfillmentComponents;
        fulfillments.push(fulfillment);
        delete fulfillmentComponents;
        delete fulfillment;

        vm.expectRevert(stdError.arithmeticError);
        _consideration.matchAdvancedOrders{ value: 99 }(
            advancedOrders,
            new CriteriaResolver[](0),
            fulfillments
        );
    }

    function _testMatchAdvancedOrdersOverflowConsiderationSide(
        ConsiderationInterface _consideration,
        ItemType itemType
    ) internal resetTokenBalancesBetweenRuns {
        test721_1.mint(alice, 1);
        _configureERC721OfferItem(1);
        _configureConsiderationItem(alice, itemType, 1, 100);

        OrderParameters memory firstOrderParameters = OrderParameters(
            address(alice),
            address(0),
            offerItems,
            considerationItems,
            OrderType.FULL_OPEN,
            block.timestamp,
            block.timestamp + 1,
            bytes32(0),
            0,
            bytes32(0),
            considerationItems.length
        );

        OrderComponents memory firstOrderComponents = getOrderComponents(
            firstOrderParameters,
            _consideration.getNonce(alice)
        );
        bytes memory firstSignature = signOrder(
            _consideration,
            alicePk,
            _consideration.getOrderHash(firstOrderComponents)
        );

        delete offerItems;
        delete considerationItems;

        test721_1.mint(bob, 2);
        _configureERC721OfferItem(2);
        _configureConsiderationItem(alice, itemType, 1, 2**256 - 1);

        OrderParameters memory secondOrderParameters = OrderParameters(
            address(bob),
            address(0),
            offerItems,
            considerationItems,
            OrderType.FULL_OPEN,
            block.timestamp,
            block.timestamp + 1,
            bytes32(0),
            0,
            bytes32(0),
            considerationItems.length
        );

        OrderComponents memory secondOrderComponents = getOrderComponents(
            secondOrderParameters,
            _consideration.getNonce(bob)
        );
        bytes memory secondSignature = signOrder(
            _consideration,
            bobPk,
            _consideration.getOrderHash(secondOrderComponents)
        );

        delete offerItems;
        delete considerationItems;

        _configureOfferItem(itemType, 1, 99);
        _configureErc721ConsiderationItem(alice, 1);
        _configureErc721ConsiderationItem(bob, 2);

        OrderParameters memory thirdOrderParameters = OrderParameters(
            address(bob),
            address(0),
            offerItems,
            considerationItems,
            OrderType.FULL_OPEN,
            block.timestamp,
            block.timestamp + 1,
            bytes32(0),
            0,
            bytes32(0),
            considerationItems.length
        );

        OrderComponents memory thirdOrderComponents = getOrderComponents(
            thirdOrderParameters,
            _consideration.getNonce(bob)
        );

        bytes memory thirdSignature = signOrder(
            _consideration,
            bobPk,
            _consideration.getOrderHash(thirdOrderComponents)
        );

        delete offerItems;
        delete considerationItems;

        AdvancedOrder[] memory advancedOrders = new AdvancedOrder[](3);
        advancedOrders[0] = AdvancedOrder(
            firstOrderParameters,
            uint120(1),
            uint120(1),
            firstSignature,
            "0x"
        );
        advancedOrders[1] = AdvancedOrder(
            secondOrderParameters,
            uint120(1),
            uint120(1),
            secondSignature,
            "0x"
        );
        advancedOrders[2] = AdvancedOrder(
            thirdOrderParameters,
            uint120(1),
            uint120(1),
            thirdSignature,
            "0x"
        );

        fulfillmentComponent = FulfillmentComponent(0, 0);
        fulfillmentComponents.push(fulfillmentComponent);
        fulfillment.offerComponents = fulfillmentComponents;
        delete fulfillmentComponents;
        fulfillmentComponent = FulfillmentComponent(2, 0);
        fulfillmentComponents.push(fulfillmentComponent);
        fulfillment.considerationComponents = fulfillmentComponents;
        fulfillments.push(fulfillment);
        delete fulfillmentComponents;
        delete fulfillment;

        fulfillmentComponent = FulfillmentComponent(1, 0);
        fulfillmentComponents.push(fulfillmentComponent);
        fulfillment.offerComponents = fulfillmentComponents;
        delete fulfillmentComponents;
        fulfillmentComponent = FulfillmentComponent(2, 1);
        fulfillmentComponents.push(fulfillmentComponent);
        fulfillment.considerationComponents = fulfillmentComponents;
        fulfillments.push(fulfillment);
        delete fulfillmentComponents;
        delete fulfillment;

        fulfillmentComponent = FulfillmentComponent(2, 0);
        fulfillmentComponents.push(fulfillmentComponent);
        fulfillment.offerComponents = fulfillmentComponents;
        delete fulfillmentComponents;
        fulfillmentComponent = FulfillmentComponent(0, 0);
        fulfillmentComponents.push(fulfillmentComponent);
        fulfillmentComponent = FulfillmentComponent(1, 0);
        fulfillmentComponents.push(fulfillmentComponent);
        fulfillment.considerationComponents = fulfillmentComponents;
        fulfillments.push(fulfillment);
        delete fulfillmentComponents;
        delete fulfillment;

        vm.expectRevert(stdError.arithmeticError);
        _consideration.matchAdvancedOrders{ value: 99 }(
            advancedOrders,
            new CriteriaResolver[](0),
            fulfillments
        );
    }

    function _testMatchAdvancedOrdersWithEmptyCriteriaEthToErc721(
        Context memory context
    )
        internal
        onlyPayable(context.args.zone)
        topUp
        resetTokenBalancesBetweenRuns
    {
        vm.assume(context.args.amount > 0);

        bytes32 conduitKey = context.args.useConduit
            ? conduitKeyOne
            : bytes32(0);

        test721_1.mint(alice, context.args.id);

        offerItems.push(
            OfferItem(
                ItemType.ERC721,
                address(test721_1),
                context.args.id,
                1,
                1
            )
        );
        considerationItems.push(
            ConsiderationItem(
                ItemType.NATIVE,
                address(0),
                0,
                context.args.amount,
                context.args.amount,
                payable(alice)
            )
        );

        OrderParameters memory orderParameters = OrderParameters(
            address(alice),
            context.args.zone,
            offerItems,
            considerationItems,
            OrderType.FULL_OPEN,
            block.timestamp,
            block.timestamp + 1,
            context.args.zoneHash,
            context.args.salt,
            conduitKey,
            considerationItems.length
        );
        OrderComponents memory orderComponents = getOrderComponents(
            orderParameters,
            context.consideration.getNonce(alice)
        );
        bytes memory signature = signOrder(
            context.consideration,
            alicePk,
            context.consideration.getOrderHash(orderComponents)
        );

        OfferItem[] memory mirrorOfferItems = new OfferItem[](1);

        // push the original order's consideration item into mirrorOfferItems
        mirrorOfferItems[0] = OfferItem(
            considerationItems[0].itemType,
            considerationItems[0].token,
            considerationItems[0].identifierOrCriteria,
            considerationItems[0].startAmount,
            considerationItems[0].endAmount
        );

        ConsiderationItem[]
            memory mirrorConsiderationItems = new ConsiderationItem[](1);

        // push the original order's offer item into mirrorConsiderationItems
        mirrorConsiderationItems[0] = ConsiderationItem(
            offerItems[0].itemType,
            offerItems[0].token,
            offerItems[0].identifierOrCriteria,
            offerItems[0].startAmount,
            offerItems[0].endAmount,
            payable(cal)
        );

        OrderParameters memory mirrorOrderParameters = OrderParameters(
            address(cal),
            context.args.zone,
            mirrorOfferItems,
            mirrorConsiderationItems,
            OrderType.FULL_OPEN,
            block.timestamp,
            block.timestamp + 1,
            context.args.zoneHash,
            context.args.salt,
            conduitKey,
            mirrorConsiderationItems.length
        );

        OrderComponents memory mirrorOrderComponents = getOrderComponents(
            mirrorOrderParameters,
            context.consideration.getNonce(cal)
        );

        bytes memory mirrorSignature = signOrder(
            context.consideration,
            calPk,
            context.consideration.getOrderHash(mirrorOrderComponents)
        );

        AdvancedOrder[] memory advancedOrders = new AdvancedOrder[](2);
        advancedOrders[0] = AdvancedOrder(
            orderParameters,
            uint120(1),
            uint120(1),
            signature,
            "0x"
        );
        advancedOrders[1] = AdvancedOrder(
            mirrorOrderParameters,
            uint120(1),
            uint120(1),
            mirrorSignature,
            "0x"
        );

        fulfillmentComponent = FulfillmentComponent(0, 0);
        fulfillmentComponents.push(fulfillmentComponent);
        firstFulfillment.offerComponents = fulfillmentComponents;
        secondFulfillment.considerationComponents = fulfillmentComponents;
        delete fulfillmentComponents;
        fulfillmentComponent = FulfillmentComponent(1, 0);
        fulfillmentComponents.push(fulfillmentComponent);
        firstFulfillment.considerationComponents = fulfillmentComponents;
        secondFulfillment.offerComponents = fulfillmentComponents;

        fulfillments.push(firstFulfillment);
        fulfillments.push(secondFulfillment);

        context.consideration.matchAdvancedOrders{ value: context.args.amount }(
            advancedOrders,
            new CriteriaResolver[](0), // no criteria resolvers
            fulfillments
        );
    }
}
