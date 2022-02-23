// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {
    OrderType,
    AssetType,
    Side
} from "./Enums.sol";

import {
    AdditionalRecipient,
    BasicOrderParameters,
    OfferedAsset,
    ReceivedAsset,
    OrderParameters,
    OrderComponents,
    Fulfillment,
    FulfillmentComponent,
    Execution,
    Order,
    OrderStatus,
    CriteriaResolver,
    Batch,
    BatchExecution
} from "./Structs.sol";

import {
    ERC20Interface,
    ERC721Interface,
    ERC1155Interface
} from "./AbridgedTokenInterfaces.sol";

import {
    ProxyRegistryInterface,
    ProxyInterface
} from "./AbridgedProxyInterfaces.sol";

import { EIP1271Interface } from "./EIP1271Interface.sol";

import { ConsiderationInterface } from "./ConsiderationInterface.sol";

/// @title Consideration is a generalized ETH/ERC20/ERC721/ERC1155 marketplace.
/// It prioritizes minimizing external calls to the greatest extent possible and
/// provides lightweight methods for common routes as well as more heavyweight
/// methods for composing advanced orders.
/// @author 0age
contract Consideration is ConsiderationInterface {
    // TODO: support partial fills as part of matchOrders?
    // TODO: skip redundant order validation when it has already been validated?

    string internal constant _NAME = "Consideration";
    string internal constant _VERSION = "1";
    uint256 internal constant _NOT_ENTERED = 1;
    uint256 internal constant _ENTERED = 2;
    uint256 internal constant _FULLY_FILLED = 1e18;

    // Precompute hashes, original chainId, and domain separator on deployment.
    bytes32 internal immutable _NAME_HASH;
    bytes32 internal immutable _VERSION_HASH;
    bytes32 internal immutable _EIP_712_DOMAIN_TYPEHASH;
    bytes32 internal immutable _OFFERED_ASSET_TYPEHASH;
    bytes32 internal immutable _RECEIVED_ASSET_TYPEHASH;
    bytes32 internal immutable _ORDER_HASH;
    uint256 internal immutable _CHAIN_ID;
    bytes32 internal immutable _DOMAIN_SEPARATOR;

    // Allow for interaction with user proxies on the legacy proxy registry.
    ProxyRegistryInterface internal immutable _LEGACY_PROXY_REGISTRY;

    // Ensure that user proxies adhere to the required proxy implementation.
    address internal immutable _REQUIRED_PROXY_IMPLEMENTATION;

    // Prevent reentrant calls on protected functions.
    uint256 internal _reentrancyGuard;

    // Track status of each order (validated, cancelled, and fraction filled).
    mapping (bytes32 => OrderStatus) internal _orderStatus;

    // Cancel offerer's orders with given facilitator (offerer => facilitator => nonce).
    mapping (address => mapping (address => uint256)) internal _facilitatorNonces;

    /// @dev Derive and set hashes, reference chainId, and associated domain separator during deployment.
    /// @param legacyProxyRegistry A proxy registry that stores per-user proxies that may optionally be used to approve transfers.
    /// @param requiredProxyImplementation The implementation that this contract will require be set on each per-user proxy.
    constructor(
        address legacyProxyRegistry,
        address requiredProxyImplementation
    ) {
        // Derive hashes, reference chainId, and associated domain separator.
        _NAME_HASH = keccak256(bytes(_NAME));
        _VERSION_HASH = keccak256(bytes(_VERSION));
        _EIP_712_DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
        _OFFERED_ASSET_TYPEHASH = keccak256("OfferedAsset(uint8 assetType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount)");
        _RECEIVED_ASSET_TYPEHASH = keccak256("ReceivedAsset(uint8 assetType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount,address account)");
        _ORDER_HASH = keccak256("OrderComponents(address offerer,address facilitator,OfferedAsset[] offer,ReceivedAsset[] consideration,uint8 orderType,uint256 startTime,uint256 endTime,uint256 salt,uint256 nonce)OfferedAsset(uint8 assetType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount)ReceivedAsset(uint8 assetType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount,address account)");
        _CHAIN_ID = block.chainid;
        _DOMAIN_SEPARATOR = _deriveDomainSeparator();

        // TODO: validate each of these based on expected codehash
        _LEGACY_PROXY_REGISTRY = ProxyRegistryInterface(legacyProxyRegistry);
        _REQUIRED_PROXY_IMPLEMENTATION = requiredProxyImplementation;

        // Initialize the reentrancy guard.
        _reentrancyGuard = _NOT_ENTERED;
    }

    /// @dev Fulfill an order offering a single ERC721 token by supplying Ether as consideration.
    /// @param etherAmount Ether that will be transferred to the initial consideration account on the fulfilled order.
    /// Note that msg.value must be greater than this amount if additonal recipients are specified.
    /// @param parameters Additional information on the fulfilled order.
    /// Note that the offerer must first approve this contract (or their proxy if indicated by the order) to transfer any offered tokens on its behalf.
    /// @return A boolean indicating whether the order was successfully fulfilled.
    function fulfillBasicEthForERC721Order(
        uint256 etherAmount,
        BasicOrderParameters memory parameters
    ) external payable override returns (bool) {
        // Move the offerer from memory to the stack.
        address payable offerer = parameters.offerer;

        // Derive and validate order using parameters and update order status.
        (bytes32 orderHash, bool useOffererProxy) = _prepareBasicFulfillment(
            parameters,
            OfferedAsset(
                AssetType.ERC721,
                parameters.token,
                parameters.identifier,
                1,
                1
            ),
            ReceivedAsset(
                AssetType.ETH,
                address(0),
                0,
                etherAmount,
                etherAmount,
                offerer
            )
        );

        // Transfer ERC721 to caller, using offerer's proxy if applicable.
        _transferERC721(
            parameters.token,
            offerer,
            msg.sender,
            parameters.identifier,
            useOffererProxy ? offerer : address(0)
        );

        // Transfer ETH to recipients, returning excess to caller, and wrap up.
        _transferETHAndFinalize(
            orderHash,
            etherAmount,
            parameters
        );

        return true;
    }

    /// @dev Fulfill an order offering ERC1155 tokens by supplying Ether as consideration.
    /// @param etherAmount Ether that will be transferred to the initial consideration account on the fulfilled order.
    /// Note that msg.value must be greater than this amount if additonal recipients are specified.
    /// @param erc1155Amount Total offererd ERC1155 tokens that will be transferred to the caller.
    /// Note that calling contracts must implement `onERC1155Received` in order to receive tokens.
    /// @param parameters Additional information on the fulfilled order.
    /// Note that the offerer must first approve this contract (or their proxy if indicated by the order) to transfer any offered tokens on its behalf.
    /// @return A boolean indicating whether the order was successfully fulfilled.
    function fulfillBasicEthForERC1155Order(
        uint256 etherAmount,
        uint256 erc1155Amount,
        BasicOrderParameters memory parameters
    ) external payable override returns (bool) {
        // Move the offerer from memory to the stack.
        address payable offerer = parameters.offerer;

        // Derive and validate order using parameters and update order status.
        (bytes32 orderHash, bool useOffererProxy) = _prepareBasicFulfillment(
            parameters,
            OfferedAsset(
                AssetType.ERC1155,
                parameters.token,
                parameters.identifier,
                erc1155Amount,
                erc1155Amount
            ),
            ReceivedAsset(
                AssetType.ETH,
                address(0),
                0,
                etherAmount,
                etherAmount,
                offerer
            )
        );

        // Transfer ERC1155 to caller, using offerer's proxy if applicable.
        _transferERC1155(
            parameters.token,
            offerer,
            msg.sender,
            parameters.identifier,
            erc1155Amount,
            useOffererProxy ? offerer : address(0)
        );

        // Transfer ETH to recipients, returning excess to caller, and wrap up.
        _transferETHAndFinalize(
            orderHash,
            etherAmount,
            parameters
        );

        return true;
    }

    /// @dev Fulfill an order offering a single ERC721 token by supplying an ERC20 token as consideration.
    /// @param erc20Token The address of the ERC20 token being supplied as consideration.
    /// @param erc20Amount ERC20 tokens that will be transferred to the initial consideration account on the fulfilled order.
    /// Note that the fulfiller must first approve this contract (or their proxy if indicated by the order) to transfer the tokens on its behalf.
    /// @param parameters Additional information on the fulfilled order.
    /// Note that the offerer must first approve this contract (or their proxy if indicated by the order) to transfer any offered tokens on its behalf.
    /// @return A boolean indicating whether the order was successfully fulfilled.
    function fulfillBasicERC20ForERC721Order(
        address erc20Token,
        uint256 erc20Amount,
        BasicOrderParameters memory parameters
    ) external override returns (bool) {
        // Derive and validate order using parameters and update order status.
        (bytes32 orderHash, bool useOffererProxy) = _prepareBasicFulfillment(
            parameters,
            OfferedAsset(
                AssetType.ERC721,
                parameters.token,
                parameters.identifier,
                1,
                1
            ),
            ReceivedAsset(
                AssetType.ERC20,
                erc20Token,
                0,
                erc20Amount,
                erc20Amount,
                parameters.offerer
            )
        );

        // Transfer ERC721 to caller, using offerer's proxy if applicable.
        _transferERC721(
            parameters.token,
            parameters.offerer,
            msg.sender,
            parameters.identifier,
            useOffererProxy ? parameters.offerer : address(0)
        );

        // Transfer ERC20 tokens to all recipients and wrap up.
        _transferERC20AndFinalize(
            msg.sender,
            parameters.offerer,
            orderHash,
            erc20Token,
            erc20Amount,
            parameters
        );

        return true;
    }

    /// @dev Fulfill an order offering ERC1155 tokens by supplying an ERC20 token as consideration.
    /// @param erc20Token The address of the ERC20 token being supplied as consideration.
    /// @param erc20Amount ERC20 tokens that will be transferred to the initial consideration account on the fulfilled order.
    /// Note that the fulfiller must first approve this contract (or their proxy if indicated by the order) to transfer the tokens on its behalf.
    /// @param erc1155Amount Total offererd ERC1155 tokens that will be transferred to the caller.
    /// Note that calling contracts must implement `onERC1155Received` in order to receive tokens.
    /// @param parameters Additional information on the fulfilled order.
    /// Note that the offerer must first approve this contract (or their proxy if indicated by the order) to transfer any offered tokens on its behalf.
    /// @return A boolean indicating whether the order was successfully fulfilled.
    function fulfillBasicERC20ForERC1155Order(
        address erc20Token,
        uint256 erc20Amount,
        uint256 erc1155Amount,
        BasicOrderParameters memory parameters
    ) external override returns (bool) {
        // Derive and validate order using parameters and update order status.
        (bytes32 orderHash, bool useOffererProxy) = _prepareBasicFulfillment(
            parameters,
            OfferedAsset(
                AssetType.ERC1155,
                parameters.token,
                parameters.identifier,
                erc1155Amount,
                erc1155Amount
            ),
            ReceivedAsset(
                AssetType.ERC20,
                erc20Token,
                0,
                erc20Amount,
                erc20Amount,
                parameters.offerer
            )
        );

        // Transfer ERC1155 to caller, using offerer's proxy if applicable.
        _transferERC1155(
            parameters.token,
            parameters.offerer,
            msg.sender,
            parameters.identifier,
            erc1155Amount,
            useOffererProxy ? parameters.offerer : address(0)
        );

        // Transfer ERC20 tokens to all recipients and wrap up.
        _transferERC20AndFinalize(
            msg.sender,
            parameters.offerer,
            orderHash,
            erc20Token,
            erc20Amount,
            parameters
        );

        return true;
    }

    /// @dev Fulfill an order offering ERC20 tokens by supplying a single ERC721 token as consideration.
    /// @param erc20Token The address of the ERC20 token being offered.
    /// @param erc20Amount ERC20 tokens that will be transferred to the caller.
    /// Note that the offerer must first approve this contract (or their proxy if indicated by the order) to transfer the tokens on its behalf.
    /// @param parameters Additional information on the fulfilled order.
    /// Note that the fulfiller must first approve this contract (or their proxy if indicated by the order) to transfer any supplied tokens on its behalf.
    /// @return A boolean indicating whether the order was successfully fulfilled.
    function fulfillBasicERC721ForERC20Order(
        address erc20Token,
        uint256 erc20Amount,
        BasicOrderParameters memory parameters
    ) external override returns (bool) {
        // Move the offerer from memory to the stack.
        address payable offerer = parameters.offerer;

        // Derive and validate order using parameters and update order status.
        (bytes32 orderHash,) = _prepareBasicFulfillment(
            parameters,
            OfferedAsset(
                AssetType.ERC20,
                erc20Token,
                0,
                erc20Amount,
                erc20Amount
            ),
            ReceivedAsset(
                AssetType.ERC721,
                parameters.token,
                parameters.identifier,
                1,
                1,
                offerer
            )
        );

        // Transfer ERC721 to offerer, using caller's proxy if applicable.
        _transferERC721(
            parameters.token,
            msg.sender,
            offerer,
            parameters.identifier,
            parameters.useFulfillerProxy ? msg.sender : address(0)
        );

        // Transfer ERC20 tokens to all recipients and wrap up.
        _transferERC20AndFinalize(
            offerer,
            msg.sender,
            orderHash,
            erc20Token,
            erc20Amount,
            parameters
        );

        return true;
    }

    /// @dev Fulfill an order offering ERC20 tokens by supplying ERC1155 tokens as consideration.
    /// @param erc20Token The address of the ERC20 token being offered.
    /// @param erc20Amount ERC20 tokens that will be transferred to the caller.
    /// Note that the offerer must first approve this contract (or their proxy if indicated by the order) to transfer the tokens on its behalf.
    /// @param erc1155Amount Total offererd ERC1155 tokens that will be transferred to the offerer.
    /// Note that offering contracts must implement `onERC1155Received` in order to receive tokens.
    /// @param parameters Additional information on the fulfilled order.
    /// Note that the fulfiller must first approve this contract (or their proxy if indicated by the order) to transfer any supplied tokens on its behalf.
    /// @return A boolean indicating whether the order was successfully fulfilled.
    function fulfillBasicERC1155ForERC20Order(
        address erc20Token,
        uint256 erc20Amount,
        uint256 erc1155Amount,
        BasicOrderParameters memory parameters
    ) external override returns (bool) {
        // Move the offerer from memory to the stack.
        address payable offerer = parameters.offerer;

        // Derive and validate order using parameters and update order status.
        (bytes32 orderHash,) = _prepareBasicFulfillment(
            parameters,
            OfferedAsset(
                AssetType.ERC20,
                erc20Token,
                0,
                erc20Amount,
                erc20Amount
            ),
            ReceivedAsset(
                AssetType.ERC1155,
                parameters.token,
                parameters.identifier,
                erc1155Amount,
                erc1155Amount,
                offerer
            )
        );

        // Transfer ERC1155 to offerer, using caller's proxy if applicable.
        _transferERC1155(
            parameters.token,
            msg.sender,
            offerer,
            parameters.identifier,
            erc1155Amount,
            parameters.useFulfillerProxy ? msg.sender : address(0)
        );

        // Transfer ERC20 tokens to all recipients and wrap up.
        _transferERC20AndFinalize(
            offerer,
            msg.sender,
            orderHash,
            erc20Token,
            erc20Amount,
            parameters
        );

        return true;
    }

    /// @dev Fulfill an order with an arbitrary number of items for offer and consideration.
    /// Note that this function does not support criteria-based orders or partial filling of orders (though filling the remainder of a partially-filled order is supported).
    /// @param order The order to fulfill.
    /// Note that both the offerer and the fulfiller must first approve this contract (or their proxy if indicated by the order) to transfer any relevant tokens on their behalf and that contracts must implement `onERC1155Received` in order to receive ERC1155 tokens.
    /// @param useFulfillerProxy A flag indicating whether to source approvals for the fulfilled tokens from their respective proxy.
    /// @return A boolean indicating whether the order was successfully fulfilled.
    function fulfillOrder(
        Order memory order,
        bool useFulfillerProxy
    ) external payable override returns (bool) {
        // Validate and fulfill the order.
        return _fulfillOrder(
            order,
            1,                          // numerator of 1
            1,                          // denominator of 1
            new CriteriaResolver[](0),  // no criteria resolvers
            useFulfillerProxy
        );
    }

    /// @dev Fulfill an order with an arbitrary number of items for offer and consideration alongside criteria resolvers containing specific token identifiers and associated proofs.
    /// Note that this function does not support partial filling of orders (though filling the remainder of a partially-filled order is supported).
    /// @param order The order to fulfill.
    /// Note that both the offerer and the fulfiller must first approve this contract (or their proxy if indicated by the order) to transfer any relevant tokens on their behalf and that contracts must implement `onERC1155Received` in order to receive ERC1155 tokens.
    /// @param criteriaResolvers An array where each element contains a reference to a specific offer or consideration, a token identifier, and a proof that the supplied token identifier is contained in the order's merkle root.
    /// Note that a criteria of zero indicates that any (transferrable) token identifier is valid and that no proof needs to be supplied.
    /// @param useFulfillerProxy A flag indicating whether to source approvals for the fulfilled tokens from their respective proxy.
    /// @return A boolean indicating whether the order was successfully fulfilled.
    function fulfillOrderWithCriteria(
        Order memory order,
        CriteriaResolver[] memory criteriaResolvers,
        bool useFulfillerProxy
    ) external payable override returns (bool) {
        // Validate and fulfill the order.
        return _fulfillOrder(
            order,
            1,                 // numerator of 1
            1,                 // denominator of 1
            criteriaResolvers, // supply criteria resolvers
            useFulfillerProxy
        );
    }

    /// @dev Partially fill some fraction of an order with an arbitrary number of items for offer and consideration.
    /// Note that an amount less than the desired amount may be filled and that this function does not support criteria-based orders.
    /// @param order The order to fulfill.
    /// Note that both the offerer and the fulfiller must first approve this contract (or their proxy if indicated by the order) to transfer any relevant tokens on their behalf and that contracts must implement `onERC1155Received` in order to receive ERC1155 tokens.
    /// @param numerator A value indicating the portion of the order that should be filled.
    /// Note that all offer and consideration components must divide with no remainder in order for the partial fill to be valid.
    /// @param denominator A value indicating the total size of the order.
    /// Note that all offer and consideration components must divide with no remainder in order for the partial fill to be valid.
    /// @param useFulfillerProxy A flag indicating whether to source approvals for the fulfilled tokens from their respective proxy.
    /// @return A boolean indicating whether the order was successfully fulfilled.
    function fulfillPartialOrder(
        Order memory order,
        uint120 numerator,
        uint120 denominator,
        bool useFulfillerProxy
    ) external payable override returns (bool) {
        // Ensure partial fills are supported by specified order.
        _ensurePartialFillsEnabled(
            numerator,
            denominator,
            order.parameters.orderType
        );

        // Validate and fulfill the order.
        return _fulfillOrder(
            order,
            numerator,
            denominator,
            new CriteriaResolver[](0),  // no criteria resolvers
            useFulfillerProxy
        );
    }

    /// @dev Partially fill some fraction of an order with an arbitrary number of items for offer and consideration alongside criteria resolvers containing specific token identifiers and associated proofs.
    /// Note that an amount less than the desired amount may be filled.
    /// @param order The order to fulfill.
    /// Note that both the offerer and the fulfiller must first approve this contract (or their proxy if indicated by the order) to transfer any relevant tokens on their behalf and that contracts must implement `onERC1155Received` in order to receive ERC1155 tokens.
    /// @param numerator A value indicating the portion of the order that should be filled.
    /// Note that all offer and consideration components must divide with no remainder in order for the partial fill to be valid.
    /// @param denominator A value indicating the total size of the order.
    /// Note that all offer and consideration components must divide with no remainder in order for the partial fill to be valid.
    /// @param criteriaResolvers An array where each element contains a reference to a specific offer or consideration, a token identifier, and a proof that the supplied token identifier is contained in the order's merkle root.
    /// Note that a criteria of zero indicates that any (transferrable) token identifier is valid and that no proof needs to be supplied.
    /// @param useFulfillerProxy A flag indicating whether to source approvals for the fulfilled tokens from their respective proxy.
    /// @return A boolean indicating whether the order was successfully fulfilled.
    function fulfillPartialOrderWithCriteria(
        Order memory order,
        uint120 numerator,
        uint120 denominator,
        CriteriaResolver[] memory criteriaResolvers,
        bool useFulfillerProxy
    ) external payable override returns (bool) {
        // Ensure partial fills are supported by specified order.
        _ensurePartialFillsEnabled(
            numerator,
            denominator,
            order.parameters.orderType
        );

        // Validate and fulfill the order.
        return _fulfillOrder(
            order,
            numerator,
            denominator,
            criteriaResolvers,
            useFulfillerProxy
        );
    }

    /// @dev Match an arbitrary number of orders, each with an arbitrary number of items for offer and consideration, supplying criteria resolvers containing specific token identifiers and associated proofs as well as fulfillments allocating offer components to consideration components.
    /// Note that this function does not support partial filling of orders (though filling the remainder of a partially-filled order is supported).
    /// @param orders The orders to match.
    /// Note that both the offerer and fulfiller on each order must first approve this contract (or their proxy if indicated by the order) to transfer any relevant tokens on their behalf and each consideration recipient must implement `onERC1155Received` in order to receive ERC1155 tokens.
    /// @param criteriaResolvers An array where each element contains a reference to a specific order as well as that order's offer or consideration, a token identifier, and a proof that the supplied token identifier is contained in the order's merkle root.
    /// Note that a root of zero indicates that any (transferrable) token identifier is valid and that no proof needs to be supplied.
    /// @param fulfillments An array of elements allocating offer components to consideration components.
    /// Note that each consideration component must be fully met in order for the match operation to be valid.
    /// @return An array of elements indicating the sequence of transfers performed as part of matching the given orders.
    function matchOrders(
        Order[] memory orders,
        CriteriaResolver[] memory criteriaResolvers,
        Fulfillment[] memory fulfillments
    ) external payable override returns (Execution[] memory) {
        // Adjust orders by filled amount and determine if they utilize proxies.
        bool[] memory useProxyPerOrder = _validateOrdersAndApplyPartials(orders);

        // Adjust order prices based on current time, startAmount and endAmount.
        unchecked {
            for (uint256 i = 0; i < orders.length; ++i) {
                orders[i] = _adjustOrderPrice(orders[i]);
            }
        }

        // Apply criteria resolvers to each order as applicable.
        _applyCriteriaResolvers(orders, criteriaResolvers);

        // Fulfill the orders using the supplied fulfillments.
        return _fulfillOrders(orders, fulfillments, useProxyPerOrder);
    }

    /// @dev Cancel an arbitrary number of orders.
    /// Note that only the offerer or the facilitator of a given order may cancel it.
    /// @param orders The orders to cancel.
    /// @return A boolean indicating whether the orders were successfully cancelled.
    function cancel(
        OrderComponents[] memory orders
    ) external override returns (bool) {
        // Ensure that the reentrancy guard is not currently set.
        _assertNonReentrant();
        unchecked {
            for (uint256 i = 0; i < orders.length; ++i) {
                OrderComponents memory order = orders[i];
                if (
                    msg.sender != order.offerer &&
                    msg.sender != order.facilitator
                ) {
                    revert OnlyOffererOrFacilitatorMayCancel();
                }

                bytes32 orderHash = _getOrderHash(
                    OrderParameters(
                        order.offerer,
                        order.facilitator,
                        order.orderType,
                        order.startTime,
                        order.endTime,
                        order.salt,
                        order.offer,
                        order.consideration
                    ),
                    order.nonce
                );

                _orderStatus[orderHash].isCancelled = true;

                emit OrderCancelled(
                    orderHash,
                    order.offerer,
                    order.facilitator
                );
            }
        }

        return true;
    }

    /// @dev Validate an arbitrary number of orders, thereby registering them as valid and allowing prospective fulfillers to skip verification.
    /// Note that anyone can validate a signed order but only the offerer can validate an order without supplying a signature.
    /// @param orders The orders to validate.
    /// @return A boolean indicating whether the orders were successfully validated.
    function validate(
        Order[] memory orders
    ) external override returns (bool) {
        // Ensure that the reentrancy guard is not currently set.
        _assertNonReentrant();
        unchecked {
            for (uint256 i = 0; i < orders.length; ++i) {
                Order memory order = orders[i];

                bytes32 orderHash = _getNoncedOrderHash(order.parameters);

                OrderStatus memory orderStatus = _getOrderStatus(
                    orderHash,
                    order.parameters.offerer,
                    order.signature,
                    false // allow partially used orders (though they're already valid!)
                );

                if (orderStatus.isValidated) {
                    revert OrderAlreadyValidated(orderHash);
                }

                _orderStatus[orderHash].isValidated = true;

                emit OrderValidated(
                    orderHash,
                    order.parameters.offerer,
                    order.parameters.facilitator
                );
            }
        }

        return true;
    }

    /// @dev Cancel all orders from a given offerer with a given facilitator in bulk by incrementing a nonce.
    /// Note that only the offerer or the facilitator may increment the nonce.
    /// @param offerer The offerer in question.
    /// @param facilitator The facilitator in question.
    /// @return newNonce The new nonce.
    function incrementFacilitatorNonce(
        address offerer,
        address facilitator
    ) external override returns (uint256 newNonce) {
        // Ensure that the reentrancy guard is not currently set.
        _assertNonReentrant();
        if (msg.sender != offerer && msg.sender != facilitator) {
            revert OnlyOffererOrFacilitatorMayIncrementNonce();
        }

        // Increment current nonce for the supplied offerer + facilitator pair.
        newNonce = ++_facilitatorNonces[offerer][facilitator];

        // Emit an event containing the new nonce and return it.
        emit FacilitatorNonceIncremented(offerer, facilitator, newNonce);
        return newNonce;
    }

    /// @dev Retrieve the status of a given order by hash, including whether the order has been cancelled or validated and the fraction of the order that has been filled.
    /// @param orderHash The order hash in question.
    /// @return The status of the order.
    function getOrderStatus(
        bytes32 orderHash
    ) external view override returns (OrderStatus memory) {
        // Return the order status.
        return _orderStatus[orderHash];
    }

    /// @dev Retrieve the current nonce for a given combination of offerer and facilitator.
    /// @param offerer The offerer in question.
    /// @param facilitator The facilitator in question.
    /// @return The current nonce.
    function facilitatorNonce(
        address offerer,
        address facilitator
    ) external view override returns (uint256) {
        // Return the nonce for the supplied offerer + facilitator pair.
        return _facilitatorNonces[offerer][facilitator];
    }

    /// @dev Retrieve the domain separator, used for signing orders via EIP-712.
    /// @return The domain separator.
    function DOMAIN_SEPARATOR() external view override returns (bytes32) {
        // Get domain separator, either precomputed or derived based on chainId.
        return _domainSeparator();
    }

    /// @dev Retrieve the order hash for a given order.
    /// @param order The components of the order.
    /// @return The order hash.
    function getOrderHash(
        OrderComponents memory order
    ) external view override returns (bytes32) {
        // Derive order hash by supplying order parameters along with the nonce.
        return _getOrderHash(
            OrderParameters(
                order.offerer,
                order.facilitator,
                order.orderType,
                order.startTime,
                order.endTime,
                order.salt,
                order.offer,
                order.consideration
            ),
            order.nonce
        );
    }

    /// @dev Retrieve the name of this contract.
    /// @return The name of this contract.
    function name() external pure override returns (string memory) {
        // Return the name of the contract.
        return _NAME;
    }

    /// @dev Retrieve the version of this contract.
    /// @return The version of this contract.
    function version() external pure override returns (string memory) {
        // Return the version.
        return _VERSION;
    }

    function _validateOrdersAndApplyPartials(
        Order[] memory orders
    ) internal returns (bool[] memory) {
        bool[] memory useOffererProxyPerOrder = new bool[](orders.length);

        unchecked {
            for (uint256 i = 0; i < orders.length; ++i) {
                Order memory order = orders[i];

                (
                    bytes32 orderHash,
                    uint120 numerator,
                    uint120 denominator,
                    bool useOffererProxy
                ) = _validateOrderAndUpdateStatus(order, 1, 1);

                useOffererProxyPerOrder[i] = useOffererProxy;

                for (uint256 j = 0; j < order.parameters.offer.length; ++j) {
                    orders[i].parameters.offer[j].endAmount = _getFraction(
                        numerator,
                        denominator,
                        orders[i].parameters.offer[j].endAmount
                    );
                }

                for (uint256 j = 0; j < order.parameters.consideration.length; ++j) {
                    orders[i].parameters.consideration[j].endAmount = _getFraction(
                        numerator,
                        denominator,
                        orders[i].parameters.consideration[j].endAmount
                    );
                }

                emit OrderFulfilled(
                    orderHash,
                    orders[i].parameters.offerer,
                    orders[i].parameters.facilitator
                );
            }
        }

        return useOffererProxyPerOrder;
    }

    function _fulfillOrder(
        Order memory order,
        uint120 numerator,
        uint120 denominator,
        CriteriaResolver[] memory criteriaResolvers,
        bool useFulfillerProxy
    ) internal returns (bool) {
        // Ensure this function cannot be triggered during a reentrant call.
        _setReentrancyGuard();

        (
            bytes32 orderHash,
            uint120 fillNumerator,
            uint120 fillDenominator,
            bool useOffererProxy
        ) = _validateOrderAndUpdateStatus(order, numerator, denominator);

        _adjustOrderPrice(order);

        Order[] memory orders = new Order[](1);
        orders[0] = order;
        order = _applyCriteriaResolvers(orders, criteriaResolvers);

        address offerer = order.parameters.offerer;

        uint256 etherRemaining = msg.value;

        for (uint256 i = 0; i < order.parameters.consideration.length;) {
            ReceivedAsset memory consideration = order.parameters.consideration[i];

            if (consideration.assetType == AssetType.ETH) {
                etherRemaining -= consideration.endAmount;
            }

            consideration.endAmount = _getFraction(
                fillNumerator,
                fillDenominator,
                consideration.endAmount
            );

            _fulfill(
                consideration,
                msg.sender,
                useFulfillerProxy
            );

            unchecked {
                 ++i;
            }
        }

        for (uint256 i = 0; i < order.parameters.offer.length;) {
            OfferedAsset memory offer = order.parameters.offer[i];

            if (offer.assetType == AssetType.ETH) {
                etherRemaining -= offer.endAmount;
            }

            ReceivedAsset memory asset = ReceivedAsset(
                offer.assetType,
                offer.token,
                offer.identifierOrCriteria,
                0,
                _getFraction(
                    fillNumerator,
                    fillDenominator,
                    offer.endAmount
                ),
                payable(msg.sender)
            );

            _fulfill(
                asset,
                offerer,
                useOffererProxy
            );

            unchecked {
                 ++i;
            }
        }

        if (etherRemaining != 0) {
            _transferEth(payable(msg.sender), etherRemaining);
        }

        emit OrderFulfilled(
            orderHash,
            offerer,
            order.parameters.facilitator
        );

        _reentrancyGuard = _NOT_ENTERED;

        return true;
    }

    function _fulfillOrders(
        Order[] memory orders,
        Fulfillment[] memory fulfillments,
        bool[] memory useOffererProxyPerOrder
    ) internal returns (Execution[] memory) {
        // Ensure this function cannot be triggered during a reentrant call.
        _setReentrancyGuard();

        // allocate fulfillment and schedule execution
        Execution[] memory executions = new Execution[](fulfillments.length);
        unchecked {
            for (uint256 i = 0; i < fulfillments.length; ++i) {
                executions[i] = _applyFulfillment(
                    orders,
                    fulfillments[i],
                    useOffererProxyPerOrder
                );
            }

            // ensure that all considerations have been met
            for (uint256 i = 0; i < orders.length; ++i) {
                ReceivedAsset[] memory considerations = orders[i].parameters.consideration;
                for (uint256 j = 0; j < considerations.length; ++j) {
                    uint256 remainingAmount = considerations[j].endAmount;
                    if (remainingAmount != 0) {
                        revert ConsiderationNotMet(i, j, remainingAmount);
                    }
                }
            }
        }

        // compress executions
        Execution[] memory standardExecutions;
        BatchExecution[] memory batchExecutions;

        (standardExecutions, batchExecutions) = _compressExecutions(executions);

        // execute fulfillments
        uint256 etherRemaining = msg.value;
        for (uint256 i = 0; i < standardExecutions.length;) {
            Execution memory execution = standardExecutions[i];

            if (execution.asset.assetType == AssetType.ETH) {
                etherRemaining -= execution.asset.endAmount;
            }

            _fulfill(
                execution.asset,
                execution.offerer,
                execution.useProxy
            );

            unchecked {
                ++i;
            }
        }

        unchecked {
            for (uint256 i = 0; i < batchExecutions.length; ++i) {
                _batchTransferERC1155(batchExecutions[i]);
            }
        }

        if (etherRemaining != 0) {
            _transferEth(payable(msg.sender), etherRemaining);
        }

        _reentrancyGuard = _NOT_ENTERED;

        return executions;
    }

    function _prepareBasicFulfillment(
        BasicOrderParameters memory parameters,
        OfferedAsset memory offeredAsset,
        ReceivedAsset memory receivedAsset
    ) internal returns (bytes32 orderHash, bool useOffererProxy) {
        // Ensure this function cannot be triggered during a reentrant call.
        _setReentrancyGuard();

        address payable offerer = parameters.offerer;
        address facilitator = parameters.facilitator;
        uint256 startTime = parameters.startTime;
        uint256 endTime = parameters.endTime;

        _ensureValidTime(startTime, endTime);

        OfferedAsset[] memory offer = new OfferedAsset[](1);
        ReceivedAsset[] memory consideration = new ReceivedAsset[](
            1 + parameters.additionalRecipients.length
        );

        offer[0] = offeredAsset;
        consideration[0] = receivedAsset;

        if (offeredAsset.assetType == AssetType.ERC20) {
            receivedAsset.assetType = AssetType.ERC20;
            receivedAsset.token = offeredAsset.token;
            receivedAsset.identifierOrCriteria = 0;
        }

        unchecked {
            for (uint256 i = 1; i < consideration.length; ++i) {
                AdditionalRecipient memory additionalRecipient = parameters.additionalRecipients[i - 1];
                receivedAsset.account = additionalRecipient.account;
                receivedAsset.startAmount = additionalRecipient.amount;
                receivedAsset.endAmount = additionalRecipient.amount;
                consideration[i] = receivedAsset;
            }
        }

        orderHash = _getNoncedOrderHash(
            OrderParameters(
                offerer,
                facilitator,
                parameters.orderType,
                startTime,
                endTime,
                parameters.salt,
                offer,
                consideration
            )
        );

        _validateBasicOrderAndUpdateStatus(
            orderHash,
            offerer,
            parameters.signature
        );

        useOffererProxy = _adjustOrderTypeAndCheckSubmitter(
            parameters.orderType,
            offerer,
            facilitator
        );

        if (useOffererProxy) {
            unchecked {
                parameters.orderType = OrderType(uint8(parameters.orderType) - 4);
            }
        }

        return (orderHash, useOffererProxy);
    }

    function _validateOrderAndUpdateStatus(
        Order memory order,
        uint120 numerator,
        uint120 denominator
    ) internal returns (
        bytes32 orderHash,
        uint120 newNumerator,
        uint120 newDenominator,
        bool useOffererProxy
    ) {
        _ensureValidTime(order.parameters.startTime, order.parameters.endTime);

        if (numerator > denominator || numerator == 0 || denominator == 0) {
            revert BadFraction();
        }

        orderHash = _getNoncedOrderHash(order.parameters);

        useOffererProxy = _adjustOrderTypeAndCheckSubmitter(
            order.parameters.orderType,
            order.parameters.offerer,
            order.parameters.facilitator
        );

        if (useOffererProxy) {
            unchecked {
                order.parameters.orderType = OrderType(
                    uint8(order.parameters.orderType) - 4
                );
            }
        }

        OrderStatus memory orderStatus = _getOrderStatus(
            orderHash,
            order.parameters.offerer,
            order.signature,
            false // allow partially used orders
        );

        // denominator of zero: this is the first fill on this order
        if (orderStatus.denominator != 0) {
            if (denominator == 1) { // full fill — just scale up to current denominator
                numerator = orderStatus.denominator;
                denominator = orderStatus.denominator;
            } else if (orderStatus.denominator != denominator) { // different denominator
                orderStatus.numerator *= denominator;
                numerator *= orderStatus.denominator;
                denominator *= orderStatus.denominator;
            }

            if (orderStatus.numerator + numerator > denominator) {
                unchecked {
                    numerator = denominator - orderStatus.numerator; // adjust down
                }
            }

            unchecked {
                _orderStatus[orderHash].isValidated = true;
                _orderStatus[orderHash].isCancelled = false;
                _orderStatus[orderHash].numerator = orderStatus.numerator + numerator;
                _orderStatus[orderHash].denominator = denominator;
            }
        } else {
            _orderStatus[orderHash].isValidated = true;
            _orderStatus[orderHash].isCancelled = false;
            _orderStatus[orderHash].numerator = numerator;
            _orderStatus[orderHash].denominator = denominator;
        }

        return (orderHash, numerator, denominator, useOffererProxy);
    }

    function _validateBasicOrderAndUpdateStatus(
        bytes32 orderHash,
        address offerer,
        bytes memory signature
    ) internal {
        _getOrderStatus(
            orderHash,
            offerer,
            signature,
            true // only allow unused orders
        );

        _orderStatus[orderHash].isValidated = true;
        _orderStatus[orderHash].isCancelled = false;
        _orderStatus[orderHash].numerator = 1;
        _orderStatus[orderHash].denominator = 1;
    }

    function _transferETHAndFinalize(
        bytes32 orderHash,
        uint256 amount,
        BasicOrderParameters memory parameters
    ) internal {
        uint256 etherRemaining = msg.value;

        for (uint256 i = 0; i < parameters.additionalRecipients.length;) {
            AdditionalRecipient memory additionalRecipient = parameters.additionalRecipients[i];
            _transferEth(
                additionalRecipient.account,
                additionalRecipient.amount
            );

            etherRemaining -= additionalRecipient.amount;

            unchecked {
                ++i;
            }
        }

        if (parameters.offerer == msg.sender) {
            _transferEth(parameters.offerer, etherRemaining);
        } else {
            _transferEth(parameters.offerer, amount);

            if (etherRemaining > amount) {
                unchecked {
                    _transferEth(payable(msg.sender), etherRemaining - amount);
                }
            }
        }

        emit OrderFulfilled(orderHash, parameters.offerer, parameters.facilitator);

        _reentrancyGuard = _NOT_ENTERED;
    }

    function _transferERC20AndFinalize(
        address from,
        address to,
        bytes32 orderHash,
        address erc20Token,
        uint256 amount,
        BasicOrderParameters memory parameters
    ) internal {
        unchecked {
            for (uint256 i = 0; i < parameters.additionalRecipients.length; ++i) {
                AdditionalRecipient memory additionalRecipient = parameters.additionalRecipients[i];
                _transferERC20(
                    erc20Token,
                    from,
                    additionalRecipient.account,
                    additionalRecipient.amount
                );
            }
        }

        _transferERC20(erc20Token, from, to, amount);

        emit OrderFulfilled(orderHash, from, parameters.facilitator);

        _reentrancyGuard = _NOT_ENTERED;
    }

    function _fulfill(
        ReceivedAsset memory asset,
        address offerer,
        bool useProxy
    ) internal {
        if (asset.assetType == AssetType.ETH) {
            _transferEth(asset.account, asset.endAmount);
        } else if (asset.assetType == AssetType.ERC20) {
            _transferERC20(
                asset.token,
                offerer,
                asset.account,
                asset.endAmount
            );
        } else {
            address proxyAddress = useProxy ? offerer : address(0);
            if (asset.assetType == AssetType.ERC721) {
                _transferERC721(
                    asset.token,
                    offerer,
                    asset.account,
                    asset.identifierOrCriteria,
                    proxyAddress
                );
            } else {
                _transferERC1155(
                    asset.token,
                    offerer,
                    asset.account,
                    asset.identifierOrCriteria,
                    asset.endAmount,
                    proxyAddress
                );
            }
        }
    }

    function _transferEth(address payable to, uint256 amount) internal {
        (bool ok, bytes memory data) = to.call{value: amount}("");
        if (!ok) {
            if (data.length != 0) {
                assembly {
                    returndatacopy(0, 0, returndatasize())
                    revert(0, returndatasize())
                }
            } else {
                revert EtherTransferGenericFailure(to, amount);
            }
        }
    }

    function _transferERC20(
        address token,
        address from,
        address to,
        uint256 amount
    ) internal {
        (bool ok, bytes memory data) = token.call(
            abi.encodeCall(
                ERC20Interface.transferFrom,
                (
                    from,
                    to,
                    amount
                )
            )
        );

        _assertValidTokenTransfer(
            ok,
            data.length,
            token,
            from,
            to,
            0,
            amount
        );

        if (!(
            data.length >= 32 &&
            abi.decode(data, (bool))
        )) {
            revert BadReturnValueFromERC20OnTransfer(token, from, to, amount);
        }
    }

    function _transferERC721(
        address token,
        address from,
        address to,
        uint256 identifier,
        address proxyOwner
    ) internal {
        (bool ok, bytes memory data) = (
            proxyOwner != address(0)
                ? _callProxy(
                    proxyOwner,
                    abi.encodeWithSelector(
                        ProxyInterface.transferERC721.selector,
                        token,
                        from,
                        to,
                        identifier
                    )
                )
                : token.call(
                    abi.encodeCall(
                        ERC721Interface.transferFrom,
                        (
                            from,
                            to,
                            identifier
                        )
                    )
                )
        );

        _assertValidTokenTransfer(
            ok,
            data.length,
            token,
            from,
            to,
            identifier,
            1
        );
    }

    function _transferERC1155(
        address token,
        address from,
        address to,
        uint256 identifier,
        uint256 amount,
        address proxyOwner
    ) internal {
        (bool ok, bytes memory data) = (
            proxyOwner != address(0)
                ? _callProxy(
                    proxyOwner,
                    abi.encodeWithSelector(
                        ProxyInterface.transferERC1155.selector,
                        token,
                        from,
                        to,
                        identifier,
                        amount
                    )
                )
                : token.call(
                    abi.encodeWithSelector(
                        ERC1155Interface.safeTransferFrom.selector,
                        from,
                        to,
                        identifier,
                        amount,
                        ""
                    )
                )
        );

        _assertValidTokenTransfer(
            ok,
            data.length,
            token,
            from,
            to,
            identifier,
            amount
        );
    }

    function _batchTransferERC1155(
        BatchExecution memory batchExecution
    ) internal {
        address token = batchExecution.token;
        address from = batchExecution.from;
        address to = batchExecution.to;
        uint256[] memory tokenIds = batchExecution.tokenIds;
        uint256[] memory amounts = batchExecution.amounts;
        (bool ok, bytes memory data) = (
            batchExecution.useProxy
                ? _callProxy(
                    batchExecution.from,
                    abi.encodeWithSelector(
                        ProxyInterface.batchTransferERC1155.selector,
                        token,
                        from,
                        to,
                        tokenIds,
                        amounts
                    )
                )
                : token.call(
                    abi.encodeWithSelector(
                        ERC1155Interface.safeBatchTransferFrom.selector,
                        from,
                        to,
                        tokenIds,
                        amounts,
                        ""
                    )
                )
        );

        if (!ok) {
            if (data.length != 0) {
                assembly {
                    returndatacopy(0, 0, returndatasize())
                    revert(0, returndatasize())
                }
            } else {
                revert ERC1155BatchTransferGenericFailure(
                    token,
                    from,
                    to,
                    tokenIds,
                    amounts
                );
            }
        }

        _assetContractIsDeployed(token, data.length);
    }

    function _callProxy(
        address proxyOwner,
        bytes memory callData
    ) internal returns (bool ok, bytes memory data) {
        // Retrieve the user proxy from the registry.
        address proxy = _LEGACY_PROXY_REGISTRY.proxies(proxyOwner);

        // Assert that the user proxy has the correct implementation.
        if (ProxyInterface(proxy).implementation() != _REQUIRED_PROXY_IMPLEMENTATION) {
            revert InvalidUserProxyImplementation();
        }

        // perform the call to the proxy.
        (ok, data) = proxy.call(callData);
    }

    function _setReentrancyGuard() internal {
        // Ensure that the reentrancy guard is not already set.
        _assertNonReentrant();

        // Set the reentrancy guard.
        _reentrancyGuard = _ENTERED;
    }

    function _assertNonReentrant() internal view {
        // Ensure that the reentrancy guard is not currently set.
        if (_reentrancyGuard == _ENTERED) {
            revert NoReentrantCalls();
        }
    }

    function _getOrderStatus(
        bytes32 orderHash,
        address offerer,
        bytes memory signature,
        bool onlyAllowUnused
    ) internal view returns (OrderStatus memory) {
        // Retrieve the order status for the given order hash.
        OrderStatus memory orderStatus = _orderStatus[orderHash];

        // Ensure that the order has not been cancelled.
        if (orderStatus.isCancelled) {
            revert OrderIsCancelled(orderHash);
        }

        // The order must be either entirely unused, or...
        if (
            orderStatus.numerator != 0 &&
            (   // partially unused and able to support partial fills.
                onlyAllowUnused ||
                orderStatus.numerator >= orderStatus.denominator
            )
        ) {
            // A partially filled order indicates no support for partial fills.
            if (orderStatus.numerator < orderStatus.denominator) {
                revert OrderNotUnused(orderHash);
            }

            // Otherwise, the order is fully filled.
            revert OrderUsed(orderHash);
        }

        // If the order is not already validated, verify the supplied signature.
        if (!orderStatus.isValidated) {
            _verifySignature(
                offerer, orderHash, signature
            );
        }

        // Return the order status.
        return orderStatus;
    }

    function _assertValidTokenTransfer(
        bool ok,
        uint256 dataLength,
        address token,
        address from,
        address to,
        uint256 tokenId,
        uint256 amount
    ) internal view {
        if (!ok) {
            if (dataLength != 0) {
                assembly {
                    returndatacopy(0, 0, returndatasize())
                    revert(0, returndatasize())
                }
            } else {
                revert TokenTransferGenericFailure(token, from, to, tokenId, amount);
            }
        }

        _assetContractIsDeployed(token, dataLength);
    }

    function _assetContractIsDeployed(
        address account,
        uint256 dataLength
    ) internal view {
        if (dataLength == 0) {
            uint256 size;
            assembly {
                size := extcodesize(account)
            }
            if (size == 0) {
                revert NoContract(account);
            }
        }
    }

    function _adjustOrderPrice(
        Order memory order
    ) internal view returns (Order memory adjustedOrder) {
        unchecked {
            uint256 duration = order.parameters.endTime - order.parameters.startTime;
            uint256 elapsed = block.timestamp - order.parameters.startTime;
            uint256 remaining = duration - elapsed;

            // adjust offer prices and round down
            for (uint256 i = 0; i < order.parameters.offer.length; ++i) {
                order.parameters.offer[i].endAmount = _locateCurrentPrice(
                    order.parameters.offer[i].startAmount,
                    order.parameters.offer[i].endAmount,
                    elapsed,
                    remaining,
                    duration,
                    false // round down
                );
            }

            // adjust consideration prices and round up
            for (uint256 i = 0; i < order.parameters.consideration.length; ++i) {
                order.parameters.consideration[i].endAmount = _locateCurrentPrice(
                    order.parameters.consideration[i].startAmount,
                    order.parameters.consideration[i].endAmount,
                    elapsed,
                    remaining,
                    duration,
                    true // round up
                );
            }

            return order;
        }
    }

    function _ensureValidTime(
        uint256 startTime,
        uint256 endTime
    ) internal view {
        if (startTime > block.timestamp || endTime < block.timestamp) {
            revert InvalidTime();
        }
    }

    function _verifySignature(
        address offerer,
        bytes32 orderHash,
        bytes memory signature
    ) internal view {
        if (offerer == msg.sender) {
            return;
        }

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", _domainSeparator(), orderHash)
        );

        bytes32 r;
        bytes32 s;
        uint8 v;

        if (signature.length == 65) {
            assembly {
                r := mload(add(signature, 0x20))
                s := mload(add(signature, 0x40))
                v := byte(0, mload(add(signature, 0x60)))
            }
        } else if (signature.length == 64) {
            bytes32 vs;
            assembly {
                r := mload(add(signature, 0x20))
                vs := mload(add(signature, 0x40))
                s := and(vs, 0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff)
                v := add(shr(255, vs), 27)
            }
        } else {
            revert BadSignatureLength(signature.length);
        }

        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            revert MalleableSignatureS(uint256(s));
        }
        if (v != 27 && v != 28) {
            revert BadSignatureV(v);
        }

        address signer = ecrecover(digest, v, r, s);

        if (signer == address(0)) {
            revert InvalidSignature();
        } else if (signer != offerer) {
            (bool ok, bytes memory data) = offerer.staticcall(
                abi.encodeWithSelector(
                    EIP1271Interface.isValidSignature.selector,
                    digest,
                    signature
                )
            );

            if (!ok) {
                if (data.length != 0) {
                    assembly {
                        returndatacopy(0, 0, returndatasize())
                        revert(0, returndatasize())
                    }
                } else {
                    revert BadContractSignature();
                }
            }

            if (
                data.length != 32 ||
                abi.decode(data, (bytes4)) != EIP1271Interface.isValidSignature.selector
            ) {
                revert BadSignature();
            }
        }
    }

    function _domainSeparator() internal view returns (bytes32) {
        return block.chainid == _CHAIN_ID ? _DOMAIN_SEPARATOR : _deriveDomainSeparator();
    }

    function _deriveDomainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                _EIP_712_DOMAIN_TYPEHASH,
                _NAME_HASH,
                _VERSION_HASH,
                block.chainid,
                address(this)
            )
        );
    }

    function _hashOfferedAsset(
        OfferedAsset memory offeredAsset
    ) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                _OFFERED_ASSET_TYPEHASH,
                offeredAsset.assetType,
                offeredAsset.token,
                offeredAsset.identifierOrCriteria,
                offeredAsset.startAmount,
                offeredAsset.endAmount
            )
        );
    }

    function _hashReceivedAsset(
        ReceivedAsset memory receivedAsset
    ) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                _RECEIVED_ASSET_TYPEHASH,
                receivedAsset.assetType,
                receivedAsset.token,
                receivedAsset.identifierOrCriteria,
                receivedAsset.startAmount,
                receivedAsset.endAmount,
                receivedAsset.account
            )
        );
    }

    function _getNoncedOrderHash(
        OrderParameters memory orderParameters
    ) internal view returns (bytes32) {
        return _getOrderHash(
            orderParameters,
            _facilitatorNonces[orderParameters.offerer][orderParameters.facilitator]
        );
    }

    function _getOrderHash(
        OrderParameters memory orderParameters,
        uint256 nonce
    ) internal view returns (bytes32) {
        uint256 offerLength = orderParameters.offer.length;
        uint256 considerationLength = orderParameters.consideration.length;
        bytes32[] memory offerHashes = new bytes32[](offerLength);
        bytes32[] memory considerationHashes = new bytes32[](considerationLength);

        unchecked {
            for (uint256 i = 0; i < offerLength; ++i) {
                offerHashes[i] = _hashOfferedAsset(orderParameters.offer[i]);
            }

            for (uint256 i = 0; i < considerationLength; ++i) {
                considerationHashes[i] = _hashReceivedAsset(orderParameters.consideration[i]);
            }
        }

        return keccak256(
            abi.encode(
                _ORDER_HASH,
                orderParameters.offerer,
                orderParameters.facilitator,
                keccak256(abi.encodePacked(offerHashes)),
                keccak256(abi.encodePacked(considerationHashes)),
                orderParameters.orderType,
                orderParameters.startTime,
                orderParameters.endTime,
                orderParameters.salt,
                nonce
            )
        );
    }

    function _adjustOrderTypeAndCheckSubmitter(
        OrderType orderType,
        address offerer,
        address facilitator
    ) internal view returns (bool useOffererProxy) {
        uint256 orderTypeAsUint256 = uint256(orderType);

        useOffererProxy = orderTypeAsUint256 > 3;

        if (
            orderTypeAsUint256 > (useOffererProxy ? 5 : 1) &&
            msg.sender != facilitator &&
            msg.sender != offerer
        ) {
            revert InvalidSubmitterOnRestrictedOrder();
        }
    }

    function _hashBatchableAssetIdentifier(
        address token,
        address from,
        address to,
        bool useProxy
    ) internal pure returns (bytes32) {
        // Note: this could use a variant of efficientHash as it's < 64 bytes
        return keccak256(abi.encode(token, from, to, useProxy));
    }

    function _locateCurrentPrice(
        uint256 startAmount,
        uint256 endAmount,
        uint256 elapsed,
        uint256 remaining,
        uint256 duration,
        bool roundUp
    ) internal pure returns (uint256) {
        if (startAmount != endAmount) {
            uint256 durationLessOne = 0;
            if (roundUp) {
                unchecked {
                    durationLessOne = duration - 1;
                }
            }
            uint256 totalBeforeDivision = (startAmount * remaining) + (endAmount * elapsed) + durationLessOne;
            uint256 newAmount;
            assembly {
                newAmount := div(totalBeforeDivision, duration)
            }
            return newAmount;
        }

        return endAmount;
    }

    function _ensurePartialFillsEnabled(
        uint120 numerator,
        uint120 denominator,
        OrderType orderType
    ) internal pure {
        if (
            numerator < denominator &&
            uint256(orderType) % 2 == 0
        ) {
            revert PartialFillsNotEnabledForOrder();
        }
    }

    function _applyCriteriaResolvers(
        Order[] memory orders,
        CriteriaResolver[] memory criteriaResolvers
    ) internal pure returns (Order memory initialOrder) {
        unchecked {
            for (uint256 i = 0; i < criteriaResolvers.length; ++i) {
                CriteriaResolver memory criteriaResolver = criteriaResolvers[i];

                uint256 orderIndex = criteriaResolver.orderIndex;

                if (orderIndex >= orders.length) {
                    revert OrderCriteriaResolverOutOfRange();
                }

                uint256 componentIndex = criteriaResolver.index;

                if (criteriaResolver.side == Side.OFFER) {
                    if (componentIndex >= orders[orderIndex].parameters.offer.length) {
                        revert OfferCriteriaResolverOutOfRange();
                    }

                    OfferedAsset memory offer = orders[orderIndex].parameters.offer[componentIndex];
                    AssetType assetType = offer.assetType;
                    if (
                        assetType != AssetType.ERC721_WITH_CRITERIA &&
                        assetType != AssetType.ERC1155_WITH_CRITERIA
                    ) {
                        revert CriteriaNotEnabledForOfferedAsset();
                    }

                    // empty criteria signifies a collection-wide offer (sell any asset)
                    if (offer.identifierOrCriteria != uint256(0)) {
                        _verifyProof(
                            criteriaResolver.identifier,
                            offer.identifierOrCriteria,
                            criteriaResolver.criteriaProof
                        );
                    }

                    orders[orderIndex].parameters.offer[componentIndex].assetType = (
                        assetType == AssetType.ERC721_WITH_CRITERIA
                            ? AssetType.ERC721
                            : AssetType.ERC1155
                    );

                    orders[orderIndex].parameters.offer[componentIndex].identifierOrCriteria = criteriaResolver.identifier;
                } else {
                    if (componentIndex >= orders[orderIndex].parameters.consideration.length) {
                        revert ConsiderationCriteriaResolverOutOfRange();
                    }

                    ReceivedAsset memory consideration = orders[orderIndex].parameters.consideration[componentIndex];
                    AssetType assetType = consideration.assetType;
                    if (
                        assetType != AssetType.ERC721_WITH_CRITERIA &&
                        assetType != AssetType.ERC1155_WITH_CRITERIA
                    ) {
                        revert CriteriaNotEnabledForConsideredAsset();
                    }

                    // empty criteria signifies a collection-wide consideration (buy any asset)
                    if (consideration.identifierOrCriteria != uint256(0)) {
                        _verifyProof(
                            criteriaResolver.identifier,
                            consideration.identifierOrCriteria,
                            criteriaResolver.criteriaProof
                        );
                    }

                    orders[orderIndex].parameters.consideration[componentIndex].assetType = (
                        assetType == AssetType.ERC721_WITH_CRITERIA
                            ? AssetType.ERC721
                            : AssetType.ERC1155
                    );

                    orders[orderIndex].parameters.consideration[componentIndex].identifierOrCriteria = criteriaResolver.identifier;
                }
            }

            for (uint256 i = 0; i < orders.length; ++i) {
                Order memory order = orders[i];
                for (uint256 j = 0; j < order.parameters.consideration.length; ++j) {
                    if (uint256(order.parameters.consideration[j].assetType) > 3) {
                        revert UnresolvedConsiderationCriteria();
                    }
                }

                for (uint256 j = 0; j < order.parameters.offer.length; ++j) {
                    if (uint256(order.parameters.offer[j].assetType) > 3) {
                        revert UnresolvedOfferCriteria();
                    }
                }
            }

            return orders[0];
        }
    }


    function _compressExecutions(
        Execution[] memory executions
    ) internal pure returns (
        Execution[] memory standardExecutions,
        BatchExecution[] memory batchExecutions
    ) {
        unchecked {
            uint256 totalExecutions = executions.length;

            if (totalExecutions < 2) {
                return (executions, new BatchExecution[](0));
            }

            uint256 total1155Executions = 0;
            uint256[] memory indexBy1155 = new uint256[](totalExecutions);

            for (uint256 i = 0; i < executions.length; ++i) {
                if (executions[i].asset.assetType == AssetType.ERC1155) {
                    indexBy1155[total1155Executions] = i;
                    ++total1155Executions;
                }
            }

            if (total1155Executions < 2) {
                return (executions, new BatchExecution[](0));
            }

            Batch[] memory batches = new Batch[](total1155Executions);

            uint256 initialExecutionIndex = indexBy1155[0];
            Execution memory initialExecution = executions[initialExecutionIndex];
            ReceivedAsset memory initialAsset = initialExecution.asset;
            bytes32 hash = _hashBatchableAssetIdentifier(
                initialAsset.token,
                initialExecution.offerer,
                initialAsset.account,
                initialExecution.useProxy
            );

            uint256[] memory executionIndices = new uint256[](1);
            executionIndices[0] = initialExecutionIndex;

            batches[0].hash = hash;
            batches[0].executionIndices = executionIndices;

            uint256 uniqueHashes = 1;

            for (uint256 i = 1; i < total1155Executions; ++i) {
                uint256 executionIndex = indexBy1155[i];
                Execution memory execution = executions[executionIndex];
                ReceivedAsset memory asset = execution.asset;

                hash = _hashBatchableAssetIdentifier(
                    asset.token,
                    execution.offerer,
                    asset.account,
                    execution.useProxy
                );

                bool hasUniqueHash = true;
                for (uint256 j = 0; j < uniqueHashes; ++j) {
                    if (hash == batches[j].hash) {
                        uint256[] memory existingExecutionIndices = batches[j].executionIndices;

                        uint256[] memory newExecutionIndices = new uint256[](existingExecutionIndices.length + 1);
                        for (uint256 k = 0; k < existingExecutionIndices.length; ++k) {
                            newExecutionIndices[k] = existingExecutionIndices[k];
                        }
                        newExecutionIndices[existingExecutionIndices.length] = indexBy1155[j];

                        batches[j].executionIndices = newExecutionIndices;

                        hasUniqueHash = false;
                    }
                }

                if (hasUniqueHash) {
                    executionIndices = new uint256[](1);
                    executionIndices[0] = executionIndex;

                    batches[uniqueHashes++].hash = hash;
                    batches[uniqueHashes].executionIndices = executionIndices;
                }
            }

            if (uniqueHashes == total1155Executions) {
                return (executions, new BatchExecution[](0));
            }

            // add one to the batch ID if it's used in a batch
            uint256[] memory usedInBatch = new uint256[](totalExecutions);

            uint256[] memory totals = new uint256[](2);
            for (uint256 i = 0; i < uniqueHashes; ++i) {
                uint256[] memory indices = batches[i].executionIndices;
                uint256 indicesLength = indices.length;
                if (indicesLength > 1) {
                    ++totals[1];
                    totals[0] += indicesLength;
                    for (uint256 j = 0; j < indicesLength; ++j) {
                        usedInBatch[indices[j]] = i + 1;
                    }
                }
            }

            return _splitExecution(
                executions,
                batches,
                usedInBatch,
                totals[0],
                totals[1]
            );
        }
    }

    function _splitExecution(
        Execution[] memory executions,
        Batch[] memory batches,
        uint256[] memory usedInBatch,
        uint256 totalUsedInBatch,
        uint256 totalBatches
    ) internal pure returns (
        Execution[] memory standardExecutions,
        BatchExecution[] memory batchExecutions
    ) {
        unchecked {
            uint256 totalExecutions = executions.length;

            Execution[] memory executeWithoutBatch = new Execution[](
                totalExecutions - totalUsedInBatch
            );
            BatchExecution[] memory executeWithBatch = new BatchExecution[](
                totalBatches
            );

            uint256 lastNoBatchIndex = 0;
            uint256[] memory batchElementCounters = new uint256[](totalBatches);
            for (uint256 i = 0; i < totalExecutions; ++i) {
                uint256 isUsedInBatch = usedInBatch[i];
                if (isUsedInBatch == 0) {
                    executeWithoutBatch[lastNoBatchIndex++] = executions[i];
                } else {
                    uint256 batchUsed = isUsedInBatch - 1;

                    Execution memory execution = executions[i];

                    if (executeWithBatch[batchUsed].token == address(0)) {
                        uint256 tokenElements = batches[batchUsed].executionIndices.length;
                        executeWithBatch[batchUsed] = BatchExecution({
                            token: execution.asset.token,
                            from: execution.offerer,
                            to: execution.asset.account,
                            tokenIds: new uint256[](tokenElements),
                            amounts: new uint256[](tokenElements),
                            useProxy: execution.useProxy
                        });
                    }

                    uint256 counter = batchElementCounters[batchUsed]++;

                    executeWithBatch[batchUsed].tokenIds[counter] = execution.asset.identifierOrCriteria;
                    executeWithBatch[batchUsed].amounts[counter] = execution.asset.endAmount;
                }
            }

            return (executeWithoutBatch, executeWithBatch);
        }
    }

    function _getOrderParametersByFulfillmentIndex(
        Order[] memory orders,
        uint256 index
    ) internal pure returns (OrderParameters memory) {
        if (index >= orders.length) {
            revert FulfilledOrderIndexOutOfRange();
        }

        return orders[index].parameters;
    }

    function _getOrderOfferComponentByAssetIndex(
        OrderParameters memory order,
        uint256 index
    ) internal pure returns (OfferedAsset memory) {
        if (index >= order.offer.length) {
            revert FulfilledOrderOfferIndexOutOfRange();
        }
        return order.offer[index];
    }

    function _getOrderConsiderationComponentByAssetIndex(
        OrderParameters memory order,
        uint256 index
    ) internal pure returns (ReceivedAsset memory) {
        if (index >= order.consideration.length) {
            revert FulfilledOrderConsiderationIndexOutOfRange();
        }
        return order.consideration[index];
    }

    function _applyFulfillment(
        Order[] memory orders,
        Fulfillment memory fulfillment,
        bool[] memory useOffererProxyPerOrder
    ) internal pure returns (
        Execution memory execution
    ) {
        if (
            fulfillment.offerComponents.length == 0 ||
            fulfillment.considerationComponents.length == 0
        ) {
            revert OfferAndConsiderationRequiredOnFulfillment();
        }

        uint256 currentOrderIndex = fulfillment.offerComponents[0].orderIndex;

        OrderParameters memory orderWithInitialOffer = _getOrderParametersByFulfillmentIndex(
            orders,
            currentOrderIndex
        );

        bool useProxy = useOffererProxyPerOrder[currentOrderIndex];

        uint256 currentAssetIndex = fulfillment.offerComponents[0].assetIndex;

        OfferedAsset memory offeredAsset = _getOrderOfferComponentByAssetIndex(
            orderWithInitialOffer,
            currentAssetIndex
        );

        orders[currentOrderIndex].parameters.offer[currentAssetIndex].endAmount = 0;

        for (uint256 i = 1; i < fulfillment.offerComponents.length;) {
            FulfillmentComponent memory offerComponent = fulfillment.offerComponents[i];
            currentOrderIndex = offerComponent.orderIndex;

            OrderParameters memory subsequentOrder = _getOrderParametersByFulfillmentIndex(
                orders,
                currentOrderIndex
            );

            currentAssetIndex = offerComponent.assetIndex;

            OfferedAsset memory additionalOfferedAsset = _getOrderOfferComponentByAssetIndex(
                subsequentOrder,
                currentAssetIndex
            );

            if (
                orderWithInitialOffer.offerer != subsequentOrder.offerer ||
                offeredAsset.assetType != additionalOfferedAsset.assetType ||
                offeredAsset.token != additionalOfferedAsset.token ||
                offeredAsset.identifierOrCriteria != additionalOfferedAsset.identifierOrCriteria ||
                useProxy != useOffererProxyPerOrder[currentOrderIndex]
            ) {
                revert MismatchedFulfillmentOfferComponents();
            }

            offeredAsset.endAmount += additionalOfferedAsset.endAmount;
            orders[currentOrderIndex].parameters.offer[currentAssetIndex].endAmount = 0;

            unchecked {
                ++i;
            }
        }

        currentOrderIndex = fulfillment.considerationComponents[0].orderIndex;

        OrderParameters memory orderWithInitialConsideration = _getOrderParametersByFulfillmentIndex(
            orders,
            currentOrderIndex
        );

        currentAssetIndex = fulfillment.considerationComponents[0].assetIndex;

        ReceivedAsset memory requiredConsideration = _getOrderConsiderationComponentByAssetIndex(
            orderWithInitialConsideration,
            currentAssetIndex
        );

        orders[currentOrderIndex].parameters.consideration[currentAssetIndex].endAmount = 0;

        for (uint256 i = 1; i < fulfillment.considerationComponents.length;) {
            FulfillmentComponent memory considerationComponent = fulfillment.considerationComponents[i];
            currentOrderIndex = considerationComponent.orderIndex;

            OrderParameters memory subsequentOrder = _getOrderParametersByFulfillmentIndex(
                orders,
                currentOrderIndex
            );

            currentAssetIndex = considerationComponent.assetIndex;

            ReceivedAsset memory additionalRequiredConsideration = _getOrderConsiderationComponentByAssetIndex(
                subsequentOrder,
                currentAssetIndex
            );

            if (
                requiredConsideration.account != additionalRequiredConsideration.account ||
                requiredConsideration.assetType != additionalRequiredConsideration.assetType ||
                requiredConsideration.token != additionalRequiredConsideration.token ||
                requiredConsideration.identifierOrCriteria != additionalRequiredConsideration.identifierOrCriteria
            ) {
                revert MismatchedFulfillmentConsiderationComponents();
            }

            requiredConsideration.endAmount += additionalRequiredConsideration.endAmount;
            orders[currentOrderIndex].parameters.consideration[currentAssetIndex].endAmount = 0;

            unchecked {
                ++i;
            }
        }

        if (requiredConsideration.endAmount > offeredAsset.endAmount) {
            FulfillmentComponent memory targetComponent = fulfillment.considerationComponents[fulfillment.considerationComponents.length - 1];
            orders[targetComponent.orderIndex].parameters.consideration[targetComponent.assetIndex].endAmount = requiredConsideration.endAmount - offeredAsset.endAmount;
            requiredConsideration.endAmount = offeredAsset.endAmount;
        } else {
            FulfillmentComponent memory targetComponent = fulfillment.offerComponents[fulfillment.offerComponents.length - 1];
            orders[targetComponent.orderIndex].parameters.offer[targetComponent.assetIndex].endAmount = offeredAsset.endAmount - requiredConsideration.endAmount;
        }

        return Execution(
            requiredConsideration,
            orderWithInitialOffer.offerer,
            useProxy
        );
    }

    function _getFraction(
        uint120 numerator,
        uint120 denominator,
        uint256 value
    ) internal pure returns (uint256 newValue) {
        if (numerator == denominator) {
            return value;
        }

        bool inexact;
        uint256 valueTimesNumerator = value * uint256(numerator);

        assembly {
            newValue := div(valueTimesNumerator, denominator)
            inexact := iszero(iszero(mulmod(value, numerator, denominator)))
        }

        if (inexact) {
            revert InexactFraction();
        }
    }

    function _verifyProof(
        uint256 leaf,
        uint256 root,
        bytes32[] memory proof
    ) internal pure {
        bytes32 computedHash = bytes32(leaf);
        unchecked {
            for (uint256 i = 0; i < proof.length; ++i) {
                bytes32 proofElement = proof[i];
                if (computedHash <= proofElement) {
                    // Hash(current computed hash + current element of the proof)
                    computedHash = _efficientHash(computedHash, proofElement);
                } else {
                    // Hash(current element of the proof + current computed hash)
                    computedHash = _efficientHash(proofElement, computedHash);
                }
            }
        }
        if (computedHash != bytes32(root)) {
            revert InvalidProof();
        }
    }

    function _efficientHash(
        bytes32 a,
        bytes32 b
    ) internal pure returns (bytes32 value) {
        assembly {
            mstore(0x00, a)
            mstore(0x20, b)
            value := keccak256(0x00, 0x40)
        }
    }
}
