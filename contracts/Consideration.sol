// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import { ConsiderationInterface } from "./interfaces/ConsiderationInterface.sol";

import { OrderType, ItemType, BasicOrderRouteType } from "./lib/ConsiderationEnums.sol";

import { BasicOrderParameters, OfferItem, ConsiderationItem, OrderParameters, OrderComponents, Fulfillment, FulfillmentComponent, Execution, Order, AdvancedOrder, OrderStatus, CriteriaResolver, BatchExecution, FulfillmentDetail } from "./lib/ConsiderationStructs.sol";

import { ConsiderationInternal } from "./lib/ConsiderationInternal.sol";

import { ConsiderationDelegated } from "./lib/ConsiderationDelegated.sol";

/**
 * @title Consideration
 * @author 0age
 * @custom:version rc-1
 * @notice Consideration is a generalized ETH/ERC20/ERC721/ERC1155 marketplace.
 *         It minimizes external calls to the greatest extent possible and
 *         provides lightweight methods for common routes as well as more
 *         flexible methods for composing advanced orders.
 */
contract Consideration is ConsiderationInterface, ConsiderationInternal {
    // Delegate some complex functionality due to the contract size limit.
    address internal immutable _DELEGATED;

    /**
     * @notice Derive and set hashes, reference chainId, and associated domain
     *         separator during deployment.
     *
     * @param legacyProxyRegistry         A proxy registry that stores per-user
     *                                    proxies that may optionally be used to
     *                                    transfer approved tokens.
     * @param requiredProxyImplementation The implementation that must be set on
     *                                    each proxy in order to utilize it.
     */
    constructor(
        address legacyProxyRegistry,
        address requiredProxyImplementation
    ) ConsiderationInternal(legacyProxyRegistry, requiredProxyImplementation) {
        // Deploy contract with additional logic where calls can be delegated.
        _DELEGATED = address(
            new ConsiderationDelegated(
                legacyProxyRegistry,
                requiredProxyImplementation
            )
        );
    }

    /**
     * @notice Fulfill an order offering an ERC20, ERC721, or ERC1155 item by
     *         supplying Ether (or other native tokens), ERC20 tokens, an ERC721
     *         item, or an ERC1155 item as consideration. Six permutations are
     *         supported: Native token to ERC721, Native token to ERC1155, ERC20
     *         to ERC721, ERC20 to ERC1155, ERC721 to ERC20, and ERC1155 to
     *         ERC20 (with native tokens supplied as msg.value). For an order to
     *         be eligible for fulfillment via this method, it must contain a
     *         single offer item (though that item may have a greater amount if
     *         the item is not an ERC721). An arbitrary number of "additional
     *         recipients" may also be supplied which will each receive native
     *         tokens or ERC20 items from the fulfiller as consideration. Refer
     *         to the documentation for a more comprehensive summary of how to
     *         utilize with this method and what orders are compatible with it.
     *
     * @param parameters Additional information on the fulfilled order. Note
     *                   that the offerer and the fulfiller must first approve
     *                   this contract (or their proxy if indicated) in order
     *                   for any tokens to be transferred. Also note that any
     *                   contract recipients of ERC1155 consideration items must
     *                   implement `onERC1155Received` in order to receive those
     *                   items.
     *
     * @return A boolean indicating whether the order has been fulfilled.
     */
    function fulfillBasicOrder(BasicOrderParameters calldata parameters)
        external
        payable
        override
        returns (bool)
    {
        // Declare enums for order route type to extract from basicOrderType.
        BasicOrderRouteType route;
        OrderType orderType;

        // Utilize assembly to extract the order type and the basic order route.
        assembly {
            // Mask all but 8 least-significant bits to derive the order type.
            orderType := and(calldataload(0x124), 7)

            // Divide basicOrderType by eight to derive the route.
            route := div(calldataload(0x124), 8)
        }

        ItemType additionalRecipientsItemType;
        address additionalRecipientsToken;
        ItemType receivedItemType;
        ItemType offeredItemType;

        // Utilize assembly to retrieve function arguments and cast types.
        assembly {
            // If route > 1 additionalRecipient items are ERC20 (1) else Eth (0)
            additionalRecipientsItemType := gt(route, 1)

            let offerTypeIsAdditionalRecipientsType := gt(route, 3)

            // If route > 3 additionalRecipientsToken is at 0xc4 else 0x24
            additionalRecipientsToken := calldataload(
                add(0x24, mul(0xa0, offerTypeIsAdditionalRecipientsType))
            )

            // If route > 2, receivedItemType is route - 2. If route is 2, then
            // receivedItemType is ERC20 (1). Otherwise, it is Eth (0).
            receivedItemType := add(
                mul(sub(route, 2), gt(route, 2)),
                eq(route, 2)
            )

            // If route > 3, offeredItemType is ERC20 (1). If route is 2 or 3,
            // offeredItemType = route. If route is 0 or 1, it is route + 2.
            offeredItemType := sub(
                add(route, mul(iszero(additionalRecipientsItemType), 2)),
                mul(
                    offerTypeIsAdditionalRecipientsType,
                    add(receivedItemType, 1)
                )
            )
        }

        address payable offerer;
        address proxyOwner;
        {
            // Derive & validate order using parameters and update order status.
            (, bool useOffererProxy) = _prepareBasicFulfillmentFromCalldata(
                parameters,
                orderType,
                receivedItemType,
                additionalRecipientsItemType,
                additionalRecipientsToken,
                offeredItemType
            );

            // Move offerer and fulfiller proxy preference from memory to stack.
            offerer = parameters.offerer;
            bool useFulfillerProxy = parameters.useFulfillerProxy;

            assembly {
                // Set proxyOwner = useOffererProxy ? offerer : address(0) for
                // route < 4 else = useFulfillerProxy ? msg.sender : address(0)
                proxyOwner := add(
                    mul(and(lt(route, 4), useOffererProxy), offerer),
                    mul(and(gt(route, 3), useFulfillerProxy), caller())
                )
            }
        }

        // Transfer tokens based on the route.
        if (route == BasicOrderRouteType.ETH_TO_ERC721) {
            // Transfer ERC721 to caller, using offerer's proxy if applicable.
            _transferERC721(
                parameters.offerToken,
                offerer,
                msg.sender,
                parameters.offerIdentifier,
                parameters.offerAmount,
                proxyOwner
            );

            // Transfer native to recipients, return excess to caller, and wrap up.
            _transferEthAndFinalize(parameters.considerationAmount, parameters);
        } else if (route == BasicOrderRouteType.ETH_TO_ERC1155) {
            // Transfer ERC1155 to caller, using offerer's proxy if applicable.
            _transferERC1155(
                parameters.offerToken,
                offerer,
                msg.sender,
                parameters.offerIdentifier,
                parameters.offerAmount,
                proxyOwner
            );

            // Transfer native to recipients, return excess to caller & wrap up.
            _transferEthAndFinalize(parameters.considerationAmount, parameters);
        } else if (route == BasicOrderRouteType.ERC20_TO_ERC721) {
            // Transfer ERC721 to caller, using offerer's proxy if applicable.
            _transferERC721(
                parameters.offerToken,
                offerer,
                msg.sender,
                parameters.offerIdentifier,
                parameters.offerAmount,
                proxyOwner
            );

            // Transfer ERC20 tokens to all recipients and wrap up.
            _transferERC20AndFinalize(
                msg.sender,
                offerer,
                parameters.considerationToken,
                parameters.considerationAmount,
                parameters,
                false // Send full amount indicated by all consideration items.
            );
        } else if (route == BasicOrderRouteType.ERC20_TO_ERC1155) {
            // Transfer ERC1155 to caller, using offerer's proxy if applicable.
            _transferERC1155(
                parameters.offerToken,
                offerer,
                msg.sender,
                parameters.offerIdentifier,
                parameters.offerAmount,
                proxyOwner
            );

            // Transfer ERC20 tokens to all recipients and wrap up.
            _transferERC20AndFinalize(
                msg.sender,
                offerer,
                parameters.considerationToken,
                parameters.considerationAmount,
                parameters,
                false // Send full amount indicated by all consideration items.
            );
        } else if (route == BasicOrderRouteType.ERC721_TO_ERC20) {
            // Transfer ERC721 to offerer, using caller's proxy if applicable.
            _transferERC721(
                parameters.considerationToken,
                msg.sender,
                offerer,
                parameters.considerationIdentifier,
                parameters.considerationAmount,
                proxyOwner
            );

            // Transfer ERC20 tokens to all recipients and wrap up.
            _transferERC20AndFinalize(
                offerer,
                msg.sender,
                parameters.offerToken,
                parameters.offerAmount,
                parameters,
                true // Reduce amount sent to fulfiller by additional amounts.
            );
        } else {
            // route == BasicOrderRouteType.ERC1155_TO_ERC20

            // Transfer ERC1155 to offerer, using caller's proxy if applicable.
            _transferERC1155(
                parameters.considerationToken,
                msg.sender,
                offerer,
                parameters.considerationIdentifier,
                parameters.considerationAmount,
                proxyOwner
            );

            // Transfer ERC20 tokens to all recipients and wrap up.
            _transferERC20AndFinalize(
                offerer,
                msg.sender,
                parameters.offerToken,
                parameters.offerAmount,
                parameters,
                true // Reduce amount sent to fulfiller by additional amounts.
            );
        }

        return true;
    }

    /**
     * @notice Fulfill an order with an arbitrary number of items for offer and
     *         consideration. Note that this function does not support
     *         criteria-based orders or partial filling of orders (though
     *         filling the remainder of a partially-filled order is supported).
     *
     * @param order             The order to fulfill. Note that both the offerer
     *                          and the fulfiller must first approve this
     *                          contract (or their proxy if indicated by the
     *                          order) to transfer any relevant tokens on their
     *                          behalf and that contracts must implement
     *                          `onERC1155Received` in order to receive ERC1155
     *                          tokens as consideration.
     * @param useFulfillerProxy A flag indicating whether to source approvals
     *                          for fulfilled tokens from an associated proxy.
     *
     * @return A boolean indicating whether the order has been fulfilled.
     */
    function fulfillOrder(Order calldata order, bool useFulfillerProxy)
        external
        payable
        override
        returns (bool)
    {
        // Convert order to "advanced" order, then validate and fulfill it.
        return
            _validateAndFulfillAdvancedOrder(
                _convertOrderToAdvanced(order),
                new CriteriaResolver[](0), // No criteria resolvers are supplied.
                useFulfillerProxy
            );
    }

    /**
     * @notice Fill an order, fully or partially, with an arbitrary number of
     *         items for offer and consideration alongside criteria resolvers
     *         containing specific token identifiers and associated proofs.
     *
     * @param advancedOrder     The order to fulfill along with the fraction of
     *                          the order to attempt to fill. Note that both the
     *                          offerer and the fulfiller must first approve
     *                          this contract (or their proxy if indicated by
     *                          the order) to transfer any relevant tokens on
     *                          their behalf and that contracts must implement
     *                          `onERC1155Received` in order to receive ERC1155
     *                          tokens as consideration. Also note that all
     *                          offer and consideration components must have no
     *                          remainder after multiplication of the respective
     *                          amount with the supplied fraction in order for
     *                          the partial fill to be considered valid.
     * @param criteriaResolvers An array where each element contains a reference
     *                          to a specific offer or consideration, a token
     *                          identifier, and a proof that the supplied token
     *                          identifier is contained in the merkle root held
     *                          by the item in question's criteria element. Note
     *                          that an empty criteria indicates that any
     *                          (transferrable) token identifier on the token in
     *                          question is valid and that no associated proof
     *                          needs to be supplied.
     * @param useFulfillerProxy A flag indicating whether to source approvals
     *                          for fulfilled tokens from an associated proxy.
     *
     * @return A boolean indicating whether the order has been fulfilled.
     */
    function fulfillAdvancedOrder(
        AdvancedOrder memory advancedOrder,
        CriteriaResolver[] memory criteriaResolvers,
        bool useFulfillerProxy
    ) external payable override returns (bool) {
        // Validate and fulfill the order.
        return
            _validateAndFulfillAdvancedOrder(
                advancedOrder,
                criteriaResolvers,
                useFulfillerProxy
            );
    }

    /**
     * @notice Attempt to fill a group of orders, fully or partially, with an
     *         arbitrary number of items for offer and consideration per order
     *         alongside criteria resolvers containing specific token
     *         identifiers and associated proofs. Any order that is not
     *         currently active, has already been fully filled, or has been
     *         cancelled will be omitted. Remaining offer and consideration
     *         items will then be aggregated where possible as indicated by the
     *         supplied offer and consideration component arrays and aggregated
     *         items will be transferred to the fulfiller or to each intended
     *         recipient, respectively. Note that a failing item transfer or an
     *         issue with order formatting will cause the entire batch to fail.
     *
     * @param advancedOrders            The orders to fulfill along with the
     *                                  fraction of those orders to attempt to
     *                                  fill. Note that both the offerer and the
     *                                  fulfiller must first approve this
     *                                  contract (or their proxy if indicated by
     *                                  the order) to transfer any relevant
     *                                  tokens on their behalf and that
     *                                  contracts must implement
     *                                  `onERC1155Received` in order to receive
     *                                  ERC1155 tokens as consideration. Also
     *                                  note that all offer and consideration
     *                                  components must have no remainder after
     *                                  multiplication of the respective amount
     *                                  with the supplied fraction for an
     *                                  order's partial fill amount to be
     *                                  considered valid.
     * @param criteriaResolvers         An array where each element contains a
     *                                  reference to a specific offer or
     *                                  consideration, a token identifier, and a
     *                                  proof that the supplied token identifier
     *                                  is contained in the merkle root held by
     *                                  the item in question's criteria element.
     *                                  Note that an empty criteria indicates
     *                                  that any (transferrable) token
     *                                  identifier on the token in question is
     *                                  valid and that no associated proof needs
     *                                  to be supplied.
     * @param offerFulfillments         An array of FulfillmentComponent arrays
     *                                  indicating which offer items to attempt
     *                                  to aggregate when preparing executions.
     * @param considerationFulfillments An array of FulfillmentComponent arrays
     *                                  indicating which consideration items to
     *                                  attempt to aggregate when preparing
     *                                  executions.
     * @param useFulfillerProxy         A flag indicating whether to source
     *                                  approvals for fulfilled tokens from an
     *                                  associated proxy.
     *
     * @return fulfillmentDetails A array of FulfillmentDetail structs, each
     *                            indicating whether the associated order has
     *                            been fulfilled and whether a proxy was used.
     * @return standardExecutions An array of elements indicating the sequence
     *                            of non-batch transfers performed as part of
     *                            matching the given orders.
     * @return batchExecutions    An array of elements indicating the sequence
     *                            of batch transfers performed as part of
     *                            matching the given orders.
     */
    function fulfillAvailableAdvancedOrders(
        AdvancedOrder[] calldata advancedOrders,
        CriteriaResolver[] calldata criteriaResolvers,
        FulfillmentComponent[][] calldata offerFulfillments,
        FulfillmentComponent[][] calldata considerationFulfillments,
        bool useFulfillerProxy
    )
        external
        payable
        override
        returns (
            FulfillmentDetail[] memory fulfillmentDetails,
            Execution[] memory standardExecutions,
            BatchExecution[] memory batchExecutions
        )
    {
        // Reference "unused" variables to silence compiler warnings.
        advancedOrders;
        criteriaResolvers;
        offerFulfillments;
        considerationFulfillments;
        useFulfillerProxy;
        fulfillmentDetails;
        standardExecutions;
        batchExecutions;

        // Execute all logic via the delegated contract.
        _delegate();
    }

    /**
     * @notice Match an arbitrary number of orders, each with an arbitrary
     *         number of items for offer and consideration along with a set of
     *         fulfillments allocating offer components to consideration
     *         components. Note that this function does not support
     *         criteria-based or partial filling of orders (though filling the
     *         remainder of a partially-filled order is supported).
     *
     * @param orders            The orders to match. Note that both the offerer
     *                          and fulfiller on each order must first approve
     *                          this contract (or their proxy if indicated by
     *                          the order) to transfer any relevant tokens on
     *                          their behalf and each consideration recipient
     *                          must implement `onERC1155Received` in order to
     *                          receive ERC1155 tokens.
     * @param fulfillments      An array of elements allocating offer components
     *                          to consideration components. Note that each
     *                          consideration component must be fully met in
     *                          order for the match operation to be valid.
     *
     * @return standardExecutions An array of elements indicating the sequence
     *                            of non-batch transfers performed as part of
     *                            matching the given orders.
     * @return batchExecutions    An array of elements indicating the sequence
     *                            of batch transfers performed as part of
     *                            matching the given orders.
     */
    function matchOrders(
        Order[] calldata orders,
        Fulfillment[] calldata fulfillments
    )
        external
        payable
        override
        returns (
            Execution[] memory standardExecutions,
            BatchExecution[] memory batchExecutions
        )
    {
        // Convert orders to "advanced" orders.
        AdvancedOrder[] memory advancedOrders = _convertOrdersToAdvanced(
            orders
        );

        // Validate orders, apply amounts, & determine if they utilize proxies.
        FulfillmentDetail[] memory fulfillmentDetails = (
            _validateOrdersAndPrepareToFulfill(
                advancedOrders,
                new CriteriaResolver[](0), // No criteria resolvers supplied.
                true // Signifies that invalid orders should revert.
            )
        );

        // Fulfill the orders using the supplied fulfillments.
        return
            _fulfillAdvancedOrders(
                advancedOrders,
                fulfillments,
                fulfillmentDetails
            );
    }

    /**
     * @notice Match an arbitrary number of full or partial orders, each with an
     *         arbitrary number of items for offer and consideration, supplying
     *         criteria resolvers containing specific token identifiers and
     *         associated proofs as well as fulfillments allocating offer
     *         components to consideration components.
     *
     * @param advancedOrders    The advanced orders to match. Note that both the
     *                          offerer and fulfiller on each order must first
     *                          approve this contract (or their proxy if
     *                          indicated by the order) to transfer any relevant
     *                          tokens on their behalf and each consideration
     *                          recipient must implement `onERC1155Received` in
     *                          order toreceive ERC1155 tokens. Also note that
     *                          the offer and consideration components for each
     *                          order must have no remainder after multiplying
     *                          the respective amount with the supplied fraction
     *                          in order for the group of partial fills to be
     *                          considered valid.
     * @param criteriaResolvers An array where each element contains a reference
     *                          to a specific order as well as that order's
     *                          offer or consideration, a token identifier, and
     *                          a proof that the supplied token identifier is
     *                          contained in the order's merkle root. Note that
     *                          an empty root indicates that any (transferrable)
     *                          token identifier is valid and that no associated
     *                          proof needs to be supplied.
     * @param fulfillments      An array of elements allocating offer components
     *                          to consideration components. Note that each
     *                          consideration component must be fully met in
     *                          order for the match operation to be valid.
     *
     * @return standardExecutions An array of elements indicating the sequence
     *                            of non-batch transfers performed as part of
     *                            matching the given orders.
     * @return batchExecutions    An array of elements indicating the sequence
     *                            of batch transfers performed as part of
     *                            matching the given orders.
     */
    function matchAdvancedOrders(
        AdvancedOrder[] memory advancedOrders,
        CriteriaResolver[] memory criteriaResolvers,
        Fulfillment[] calldata fulfillments
    )
        external
        payable
        override
        returns (
            Execution[] memory standardExecutions,
            BatchExecution[] memory batchExecutions
        )
    {
        // Validate orders, apply amounts, & determine if they utilize proxies.
        FulfillmentDetail[] memory fulfillmentDetails = (
            _validateOrdersAndPrepareToFulfill(
                advancedOrders,
                criteriaResolvers,
                true // Signifies that invalid orders should revert.
            )
        );

        // Fulfill the orders using the supplied fulfillments.
        return
            _fulfillAdvancedOrders(
                advancedOrders,
                fulfillments,
                fulfillmentDetails
            );
    }

    /**
     * @notice Cancel an arbitrary number of orders. Note that only the offerer
     * or the zone of a given order may cancel it.
     *
     * @param orders The orders to cancel.
     *
     * @return A boolean indicating whether the supplied orders were
     *         successfully cancelled.
     */
    function cancel(OrderComponents[] memory orders)
        external
        override
        returns (bool)
    {
        // Ensure that the reentrancy guard is not currently set.
        _assertNonReentrant();

        address offerer;
        address zone;

        // Skip overflow check as for loop is indexed starting at zero.
        unchecked {
            // Read length of the orders array from memory and place on stack.
            uint256 totalOrders = orders.length;

            // Iterate over each order.
            for (uint256 i = 0; i < totalOrders; ) {
                // Retrieve the order.
                OrderComponents memory order = orders[i];

                offerer = order.offerer;
                zone = order.zone;

                // Ensure caller is either offerer or zone of the order.
                if (msg.sender != offerer && msg.sender != zone) {
                    revert InvalidCanceller();
                }

                // Derive order hash using the order parameters and the nonce.
                bytes32 orderHash = _getOrderHash(
                    OrderParameters(
                        offerer,
                        zone,
                        order.offer,
                        order.consideration,
                        order.orderType,
                        order.startTime,
                        order.endTime,
                        order.zoneHash,
                        order.salt,
                        order.consideration.length
                    ),
                    order.nonce
                );

                // Update the order status as not valid and cancelled.
                _orderStatus[orderHash].isValidated = false;
                _orderStatus[orderHash].isCancelled = true;

                // Emit an event signifying that the order has been cancelled.
                emit OrderCancelled(orderHash, offerer, zone);

                // Increment counter inside body of loop for gas efficiency.
                ++i;
            }
        }

        return true;
    }

    /**
     * @notice Validate an arbitrary number of orders, thereby registering them
     *         as valid and allowing the fulfiller to skip verification. Note
     *         that anyone can validate a signed order but only the offerer can
     *         validate an order without supplying a signature.
     *
     * @param orders The orders to validate.
     *
     * @return A boolean indicating whether the supplied orders were
     *         successfully validated.
     */
    function validate(Order[] memory orders) external override returns (bool) {
        // Ensure that the reentrancy guard is not currently set.
        _assertNonReentrant();

        // Declare variables outside of the loop.
        bytes32 orderHash;
        address offerer;

        // Skip overflow check as for loop is indexed starting at zero.
        unchecked {
            // Read length of the orders array from memory and place on stack.
            uint256 totalOrders = orders.length;

            // Iterate over each order.
            for (uint256 i = 0; i < totalOrders; ) {
                // Retrieve the order.
                Order memory order = orders[i];

                // Retrieve the order parameters.
                OrderParameters memory orderParameters = order.parameters;

                // Move offerer from memory to the stack.
                offerer = orderParameters.offerer;

                // Get current nonce and use it w/ params to derive order hash.
                orderHash = _assertConsiderationLengthAndGetNoncedOrderHash(
                    orderParameters
                );

                // Retrieve the order status using the derived order hash.
                OrderStatus memory orderStatus = _orderStatus[orderHash];

                // Ensure order is fillable and retrieve the filled amount.
                _verifyOrderStatus(
                    orderHash,
                    orderStatus,
                    false, // Signifies that partially filled orders are valid.
                    true // Signifies to revert if the order is invalid.
                );

                // If the order has not already been validated...
                if (!orderStatus.isValidated) {
                    // Verify the supplied signature.
                    _verifySignature(offerer, orderHash, order.signature);

                    // Update order status to mark the order as valid.
                    _orderStatus[orderHash].isValidated = true;

                    // Emit an event signifying the order has been validated.
                    emit OrderValidated(
                        orderHash,
                        offerer,
                        orderParameters.zone
                    );
                }

                // Increment counter inside body of the loop for gas efficiency.
                ++i;
            }
        }

        return true;
    }

    /**
     * @notice Cancel all orders from a given offerer with a given zone in bulk
     *         by incrementing a nonce. Note that only the offerer may increment
     *         the nonce.
     *
     * @return newNonce The new nonce.
     */
    function incrementNonce() external override returns (uint256 newNonce) {
        // Ensure that the reentrancy guard is not currently set.
        _assertNonReentrant();

        // No need to check for overflow; nonce cannot be incremented that far.
        unchecked {
            // Increment current nonce for the supplied offerer.
            newNonce = ++_nonces[msg.sender];
        }

        // Emit an event containing the new nonce.
        emit NonceIncremented(newNonce, msg.sender);
    }

    /**
     * @notice Retrieve the order hash for a given order.
     *
     * @param order The components of the order.
     *
     * @return The order hash.
     */
    function getOrderHash(OrderComponents memory order)
        external
        view
        override
        returns (bytes32)
    {
        // Derive order hash by supplying order parameters along with the nonce.
        return
            _getOrderHash(
                OrderParameters(
                    order.offerer,
                    order.zone,
                    order.offer,
                    order.consideration,
                    order.orderType,
                    order.startTime,
                    order.endTime,
                    order.zoneHash,
                    order.salt,
                    order.consideration.length
                ),
                order.nonce
            );
    }

    /**
     * @notice Retrieve the status of a given order by hash, including whether
     *         the order has been cancelled or validated and the fraction of the
     *         order that has been filled.
     *
     * @param orderHash The order hash in question.
     *
     * @return isValidated A boolean indicating whether the order in question
     *                     has been validated (i.e. previously approved or
     *                     partially filled).
     * @return isCancelled A boolean indicating whether the order in question
     *                     has been cancelled.
     * @return totalFilled The total portion of the order that has been filled
     *                     (i.e. the "numerator").
     * @return totalSize   The total size of the order that is either filled or
     *                     unfilled (i.e. the "denominator").
     */
    function getOrderStatus(bytes32 orderHash)
        external
        view
        override
        returns (
            bool isValidated,
            bool isCancelled,
            uint256 totalFilled,
            uint256 totalSize
        )
    {
        // Retrieve the order status using the order hash.
        OrderStatus memory orderStatus = _orderStatus[orderHash];

        // Return the fields on the order status.
        return (
            orderStatus.isValidated,
            orderStatus.isCancelled,
            orderStatus.numerator,
            orderStatus.denominator
        );
    }

    /**
     * @notice Retrieve the current nonce for a given offerer.
     *
     * @param offerer The offerer in question.
     *
     * @return The current nonce.
     */
    function getNonce(address offerer)
        external
        view
        override
        returns (uint256)
    {
        // Return the nonce for the supplied offerer.
        return _nonces[offerer];
    }

    /**
     * @notice Retrieve the domain separator, used for signing and verifying
     * signed orders via EIP-712.
     *
     * @return The domain separator.
     */
    function DOMAIN_SEPARATOR() external view override returns (bytes32) {
        // Get domain separator, either precomputed or derived based on chainId.
        return _domainSeparator();
    }

    /**
     * @notice Retrieve the name of this contract.
     *
     * @return The name of this contract.
     */
    function name() external pure override returns (string memory) {
        // Return the name of the contract.
        return _NAME;
    }

    /**
     * @notice Retrieve the version of this contract.
     *
     * @return The version of this contract.
     */
    function version() external pure override returns (string memory) {
        // Return the version.
        return _VERSION;
    }

    /**
     * @dev Internal function to delegate all logic to the delegated contract.
     *      Control flow will be completely overridden on calling this function.
     */
    function _delegate() internal {
        // Read delegated logic contract from runtime code and place on stack.
        address delegated = _DELEGATED;

        // Utilize assembly for direct access to calldata and returndata buffer.
        assembly {
            // Copy entirety of calldata directly into memory with no offset.
            // This clobbers existing memory, including the free memory pointer,
            // but it will not be needed from this point forward.
            calldatacopy(
                returndatasize(), // Put 0 on the stack for the memory offset.
                returndatasize(), // Put 0 on the stack for the calldata offset.
                calldatasize() // Supply full length for the calldata length.
            )

            // Perform the delegatecall to the delegated logic contract. Memory
            // will not be written to as returndatasize is not known ahead of
            // time; instead, utilize the returndata buffer.
            let success := delegatecall(
                gas(), // Forward all available gas.
                delegated, // Supply delegated logic contract address.
                returndatasize(), // Put 0 on the stack for memory-in offset.
                calldatasize(), // Use calldata length for memory-in length.
                returndatasize(), // Put 0 on the stack for memory-out offset.
                returndatasize() // Put 0 on the stack for memory-out length.
            )

            // Copy the returndata buffer into memory with no offset.
            returndatacopy(0, 0, returndatasize())

            // Return or revert based on the success status of the delegatecall,
            // passing along the original returndata. No special handling in the
            // case of delegated calls to accounts with no code is required here
            // as the delegated contract is not destructible.
            switch success
            case 0 {
                revert(0, returndatasize()) // Revert with returndata in memory.
            }
            default {
                return(0, returndatasize()) // Return with returndata in memory.
            }
        }
    }
}
