// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import { EIP1271Interface } from "../interfaces/EIP1271Interface.sol";

import { ZoneInterface } from "../interfaces/ZoneInterface.sol";

import { OrderType, ItemType, Side } from "./ConsiderationEnums.sol";

// prettier-ignore
import {
    OfferItem,
    ConsiderationItem,
    SpentItem,
    ReceivedItem,
    OrderParameters,
    Order,
    AdvancedOrder,
    CriteriaResolver,
    OrderStatus,
    Execution
} from "./ConsiderationStructs.sol";

import { ConsiderationPure } from "./ConsiderationPure.sol";

import { SignatureVerification } from "./SignatureVerification.sol";

import "./ConsiderationConstants.sol";

/**
 * @title ConsiderationInternalView
 * @author 0age
 * @notice ConsiderationInternal contains all internal view functions.
 */
contract ConsiderationInternalView is ConsiderationPure, SignatureVerification {
    /**
     * @dev Derive and set hashes, reference chainId, and associated domain
     *      separator during deployment.
     *
     * @param conduitController A contract that deploys conduits, or proxies
     *                          that may optionally be used to transfer approved
     *                          ERC20/721/1155 tokens.
     */
    constructor(address conduitController)
        ConsiderationPure(conduitController)
    {}

    /**
     * @dev Internal view function to ensure that the sentinel value for the
            reentrancy guard is not currently set.
     */
    function _assertNonReentrant() internal view {
        // Ensure that the reentrancy guard is not currently set.
        if (_reentrancyGuard != _NOT_ENTERED) {
            revert NoReentrantCalls();
        }
    }

    /**
     * @dev Internal view function to ensure that the current time falls within
     *      an order's valid timespan.
     *
     * @param startTime       The time at which the order becomes active.
     * @param endTime         The time at which the order becomes inactive.
     * @param revertOnInvalid A boolean indicating whether to revert if the
     *                        order is not active.
     *
     * @return valid A boolean indicating whether the order is active.
     */
    function _verifyTime(
        uint256 startTime,
        uint256 endTime,
        bool revertOnInvalid
    ) internal view returns (bool valid) {
        // Revert if order's timespan hasn't started yet or has already ended.
        if (startTime > block.timestamp || endTime <= block.timestamp) {
            // Only revert if revertOnInvalid has been supplied as true.
            if (revertOnInvalid) {
                revert InvalidTime();
            }

            // Return false as the order is invalid.
            return false;
        }

        // Return true as the order time is valid.
        valid = true;
    }

    /**
     * @dev Internal view function to verify the signature of an order. An
     *      ERC-1271 fallback will be attempted if either the signature length
     *      is not 32 or 33 bytes or if the recovered signer does not match the
     *      supplied offerer. Note that in cases where a 32 or 33 byte signature
     *      is supplied, only standard ECDSA signatures that recover to a
     *      non-zero address are supported.
     *
     * @param offerer   The offerer for the order.
     * @param orderHash The order hash.
     * @param signature A signature from the offerer indicating that the order
     *                  has been approved.
     */
    function _verifySignature(
        address offerer,
        bytes32 orderHash,
        bytes memory signature
    ) internal view {
        // Skip signature verification if the offerer is the caller.
        if (offerer == msg.sender) {
            return;
        }

        // Derive EIP-712 digest using the domain separator and the order hash.
        bytes32 digest = _hashDigest(_domainSeparator(), orderHash);

        // Verify the signature using the digest.
        _verifySignatureUsingDigest(offerer, digest, signature);
    }

    /**
     * @dev Internal view function to get the EIP-712 domain separator. If the
     *      chainId matches the chainId set on deployment, the cached domain
     *      separator will be returned; otherwise, it will be derived from
     *      scratch.
     */
    function _domainSeparator() internal view returns (bytes32) {
        // prettier-ignore
        return block.chainid == _CHAIN_ID
            ? _DOMAIN_SEPARATOR
            : _deriveDomainSeparator();
    }

    /**
     * @dev Internal view function to derive the order hash for a given order.
     *      Note that only the original consideration items are included in the
     *      order hash, as additional consideration items may be supplied by the
     *      caller.
     *
     * @param orderParameters The parameters of the order to hash.
     * @param nonce           The nonce of the order to hash.
     *
     * @return orderHash The hash.
     */
    function _getOrderHash(
        OrderParameters memory orderParameters,
        uint256 nonce
    ) internal view returns (bytes32 orderHash) {
        // Get length of original consideration array and place it on the stack.
        uint256 originalConsiderationLength = (
            orderParameters.totalOriginalConsiderationItems
        );

        /*
         * Memory layout for an array of structs (dynamic or not) is similar
         * to ABI encoding of dynamic types, with a head segment followed by
         * a data segment. The main difference is that the head of an element
         * is a memory pointer rather than an offset.
         */

        // Declare a variable for the derived hash of the offer array.
        bytes32 offerHash;

        // Read offer item EIP-712 typehash from runtime code & place on stack.
        bytes32 typeHash = _OFFER_ITEM_TYPEHASH;

        // Utilize assembly so that memory regions can be reused across hashes.
        assembly {
            // Retrieve the free memory pointer and place on the stack.
            let hashArrPtr := mload(FreeMemoryPointerSlot)

            // Get the pointer to the offers array.
            let offerArrPtr := mload(add(orderParameters, 0x40))

            // Load the length.
            let offerLength := mload(offerArrPtr)

            // Set the pointer to the first offer's head.
            offerArrPtr := add(offerArrPtr, 0x20)

            // Iterate over the offer items.
            // prettier-ignore
            for { let i := 0 } lt(i, offerLength) {
                i := add(i, 1)
            } {
                // Read the pointer to the offer data and subtract 32
                // to get typeHash pointer.
                let ptr := sub(mload(offerArrPtr), 0x20)

                // Read the current value before the offer data.
                let value := mload(ptr)

                // Write the type hash to the previous word.
                mstore(ptr, typeHash)

                // Take the EIP712 hash and store it in the hash array.
                mstore(hashArrPtr, keccak256(ptr, 0xc0))

                // Restore the previous word.
                mstore(ptr, value)

                // Increment the array pointers.
                offerArrPtr := add(offerArrPtr, 0x20)
                hashArrPtr := add(hashArrPtr, 0x20)
            }

            // Derive the offer hash.
            offerHash := keccak256(
                mload(FreeMemoryPointerSlot),
                mul(offerLength, 0x20)
            )
        }

        // Declare a variable for the derived hash of the consideration array.
        bytes32 considerationHash;

        // Read consideration item typehash from runtime code & place on stack.
        typeHash = _CONSIDERATION_ITEM_TYPEHASH;

        // Utilize assembly so that memory regions can be reused across hashes.
        assembly {
            // Retrieve the free memory pointer and place on the stack.
            let hashArrPtr := mload(FreeMemoryPointerSlot)

            // Get the pointer to the consideration array.
            let considerationArrPtr := add(
                mload(add(orderParameters, 0x60)),
                0x20
            )

            // Iterate over the offer items.
            // prettier-ignore
            for { let i := 0 } lt(i, originalConsiderationLength) {
                i := add(i, 1)
            } {
                // Read the pointer to the consideration data and subtract 32
                // to get typeHash pointer.
                let ptr := sub(mload(considerationArrPtr), 0x20)

                // Read the current value before the consideration data.
                let value := mload(ptr)

                // Write the type hash to the previous word.
                mstore(ptr, typeHash)

                // Take the EIP712 hash and store it in the hash array.
                mstore(hashArrPtr, keccak256(ptr, 0xe0))

                // Restore the previous word.
                mstore(ptr, value)

                // Increment the array pointers.
                considerationArrPtr := add(considerationArrPtr, 0x20)
                hashArrPtr := add(hashArrPtr, 0x20)
            }

            // Derive the offer hash.
            considerationHash := keccak256(
                mload(FreeMemoryPointerSlot),
                mul(originalConsiderationLength, 0x20)
            )
        }

        // Read order item EIP-712 typehash from runtime code & place on stack.
        typeHash = _ORDER_TYPEHASH;

        // Utilize assembly to access derived hashes & other arguments directly.
        assembly {
            let typeHashPtr := sub(orderParameters, 0x20)
            let previousValue := mload(typeHashPtr)
            mstore(typeHashPtr, typeHash)

            let offerHeadPtr := add(orderParameters, 0x40)
            let offerDataPtr := mload(offerHeadPtr)
            mstore(offerHeadPtr, offerHash)

            let considerationHeadPtr := add(orderParameters, 0x60)
            let considerationDataPtr := mload(considerationHeadPtr)
            mstore(considerationHeadPtr, considerationHash)

            let noncePtr := add(orderParameters, 0x140)
            mstore(noncePtr, nonce)

            orderHash := keccak256(typeHashPtr, 0x180)
            mstore(typeHashPtr, previousValue)
            mstore(offerHeadPtr, offerDataPtr)
            mstore(considerationHeadPtr, considerationDataPtr)
            mstore(noncePtr, originalConsiderationLength)
        }
    }

    /**
     * @dev Internal view function to to ensure that the supplied consideration
     *      array length on a given set of order parameters is not less than the
     *      original consideration array length for that order and to retrieve
     *      the current nonce for a given order's offerer and zone and use it to
     *      derive the order hash.
     *
     * @param orderParameters The parameters of the order to hash.
     *
     * @return The hash.
     */
    function _assertConsiderationLengthAndGetNoncedOrderHash(
        OrderParameters memory orderParameters
    ) internal view returns (bytes32) {
        // Ensure supplied consideration array length is not less than original.
        _assertConsiderationLengthIsNotLessThanOriginalConsiderationLength(
            orderParameters.consideration.length,
            orderParameters.totalOriginalConsiderationItems
        );

        // Derive and return order hash using current nonce for the offerer.
        return _getOrderHash(orderParameters, _nonces[orderParameters.offerer]);
    }

    /**
     * @dev Internal view function to determine if an order has a restricted
     *      order type and, if so, to ensure that either the offerer or the zone
     *      are the fulfiller or that a staticcall to `isValidOrder` on the zone
     *      returns a magic value indicating that the order is currently valid.
     *
     * @param orderHash The hash of the order.
     * @param zoneHash  The hash to provide upon calling the zone.
     * @param orderType The type of the order.
     * @param offerer   The offerer in question.
     * @param zone      The zone in question.
     */
    function _assertRestrictedBasicOrderValidity(
        bytes32 orderHash,
        bytes32 zoneHash,
        OrderType orderType,
        address offerer,
        address zone
    ) internal view {
        // Order type 2-3 require zone or offerer be caller or zone to approve.
        if (
            uint256(orderType) > 1 &&
            msg.sender != zone &&
            msg.sender != offerer
        ) {
            // Perform minimal staticcall to the zone.
            _callIsValidOrder(zone, orderHash, offerer, zoneHash);
        }
    }

    function _callIsValidOrder(
        address zone,
        bytes32 orderHash,
        address offerer,
        bytes32 zoneHash
    ) internal view {
        // Perform minimal staticcall to the zone.
        bool success = _staticcall(
            zone,
            abi.encodeWithSelector(
                ZoneInterface.isValidOrder.selector,
                orderHash,
                msg.sender,
                offerer,
                zoneHash
            )
        );

        // Ensure call was successful and returned the correct magic value.
        _assertIsValidOrderStaticcallSuccess(success, orderHash);
    }

    /**
     * @dev Internal view function to determine whether an order is a restricted
     *      order and, if so, to ensure that it was either submitted by the
     *      offerer or the zone for the order, or that the zone returns the
     *      expected magic value upon performing a staticcall to `isValidOrder`
     *      or `isValidOrderIncludingExtraData` depending on whether the order
     *      fulfillment specifies extra data or criteria resolvers.
     *
     * @param advancedOrder     The advanced order in question.
     * @param criteriaResolvers An array where each element contains a reference
     *                          to a specific offer or consideration, a token
     *                          identifier, and a proof that the supplied token
     *                          identifier is contained in the order's merkle
     *                          root. Note that a criteria of zero indicates
     *                          that any (transferrable) token identifier is
     *                          valid and that no proof needs to be supplied.
     * @param priorOrderHashes  The order hashes of each order supplied prior to
     *                          the current order as part of a "match" variety
     *                          of order fulfillment (e.g. this array will be
     *                          empty for single or "fulfill available").
     * @param orderHash         The hash of the order.
     * @param zoneHash          The hash to provide upon calling the zone.
     * @param orderType         The type of the order.
     * @param offerer           The offerer in question.
     * @param zone              The zone in question.
     */
    function _assertRestrictedAdvancedOrderValidity(
        AdvancedOrder memory advancedOrder,
        CriteriaResolver[] memory criteriaResolvers,
        bytes32[] memory priorOrderHashes,
        bytes32 orderHash,
        bytes32 zoneHash,
        OrderType orderType,
        address offerer,
        address zone
    ) internal view {
        // Order type 2-3 require zone or offerer be caller or zone to approve.
        if (
            uint256(orderType) > 1 &&
            msg.sender != zone &&
            msg.sender != offerer
        ) {
            // If no extraData or criteria resolvers are supplied...
            if (
                advancedOrder.extraData.length == 0 &&
                criteriaResolvers.length == 0
            ) {
                // Perform minimal staticcall to the zone.
                _callIsValidOrder(zone, orderHash, offerer, zoneHash);
            } else {
                // Otherwise, extra data or criteria resolvers were supplied; in
                // that event, perform a more verbose staticcall to the zone.
                bool success = _staticcall(
                    zone,
                    abi.encodeWithSelector(
                        ZoneInterface.isValidOrderIncludingExtraData.selector,
                        orderHash,
                        msg.sender,
                        advancedOrder,
                        priorOrderHashes,
                        criteriaResolvers
                    )
                );

                // Ensure call was successful and returned correct magic value.
                _assertIsValidOrderStaticcallSuccess(success, orderHash);
            }
        }
    }

    /**
     * @dev Internal view function to ensure that a staticcall to `isValidOrder`
     *      or `isValidOrderIncludingExtraData` as part of validating a
     *      restricted order that was not submitted by the named offerer or zone
     *      was successful and returned the required magic value.
     *
     * @param success   A boolean indicating the status of the staticcall.
     * @param orderHash The order hash of the order in question.
     */
    function _assertIsValidOrderStaticcallSuccess(
        bool success,
        bytes32 orderHash
    ) internal view {
        // If the call failed...
        if (!success) {
            // Revert and pass reason along if one was returned.
            _revertWithReasonIfOneIsReturned();

            // Otherwise, revert with a generic error message.
            revert InvalidRestrictedOrder(orderHash);
        }

        // Ensure result was extracted and matches isValidOrder magic value.
        if (_doesNotMatchMagic(ZoneInterface.isValidOrder.selector)) {
            revert InvalidRestrictedOrder(orderHash);
        }
    }

    /**
     * @dev Internal view function to derive the address of a given conduit
     *      using a corresponding conduit key.
     *
     * @param conduitKey A bytes32 value indicating what corresponding conduit,
     *                   if any, to source token approvals from. This value is
     *                   the "salt" parameter supplied by the deployer (i.e. the
     *                   conduit controller) when deploying the given conduit.
     *
     * @return conduit The address of the conduit associated with the given
     *                 conduit key.
     */
    function _deriveConduit(bytes32 conduitKey)
        internal
        view
        returns (address conduit)
    {
        // Read conduit controller address from runtime and place on the stack.
        address conduitController = address(_CONDUIT_CONTROLLER);

        // Read conduit creation code hash from runtime and place on the stack.
        bytes32 conduitCreationCodeHash = _CONDUIT_CREATION_CODE_HASH;

        // Leverage scratch space to perform an efficient hash.
        assembly {
            // Retrieve the free memory pointer; it will be replaced afterwards.
            let freeMemoryPointer := mload(FreeMemoryPointerSlot)

            // Place the control character and the conduit controller in scratch
            // space; note that eleven bytes at the beginning are left unused.
            mstore(
                0x00,
                or(
                    0x0000000000000000000000ff0000000000000000000000000000000000000000, // solhint-disable-line max-line-length
                    conduitController
                )
            )

            // Place the conduit key in the next region of scratch space.
            mstore(0x20, conduitKey)

            // Place conduit creation code hash in free memory pointer location.
            mstore(0x40, conduitCreationCodeHash)

            // Derive conduit by hashing and applying a mask over last 20 bytes.
            conduit := and(
                keccak256(0x0b, 0x55), // Hash the relevant region.
                0x000000000000000000000000ffffffffffffffffffffffffffffffffffffffff // solhint-disable-line max-line-length
            )

            // Restore the free memory pointer.
            mstore(FreeMemoryPointerSlot, freeMemoryPointer)
        }
    }

    /**
     * @dev Internal view function to retrieve configuration information for
     *      this contract.
     *
     * @return version           The contract version.
     * @return domainSeparator   The domain separator for this contract.
     * @return conduitController The conduit Controller set for this contract.
     */
    function _information()
        internal
        view
        returns (
            string memory version,
            bytes32 domainSeparator,
            address conduitController
        )
    {
        // Declare variable as immutables cannot be accessed within assembly.
        uint256 versionBytes = _VERSION;

        // Derive the domain separator.
        domainSeparator = _domainSeparator();

        // Declare variable as immutables cannot be accessed within assembly.
        conduitController = address(_CONDUIT_CONTROLLER);

        // Allocate a string with length one.
        version = new string(1);

        // Set the version as data on the newly allocated string.
        assembly {
            mstore(add(version, OneWord), versionBytes)
        }
    }

    /**
     * @dev Internal pure function to retrieve the name of this contract.
     *
     * @return The name of this contract.
     */
    function _name() internal pure returns (string memory) {
        // Declare variable as immutables cannot be accessed within assembly.
        uint256 nameBytes = _NAME;

        // Return the name of the contract.
        assembly {
            mstore(0, OneWord) // First element is the offset.
            mstore(OneWord, 13) // Second element is the length.
            mstore(TwoWords, nameBytes) // Third element is the data.
            return(0, ThreeWords) // Return all three words.
        }
    }
}
