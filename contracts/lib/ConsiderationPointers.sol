// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

// Common Offsets
// Offsets to fields within -Item structs

uint256 constant CommonItemTypeOffset = 0x20;
uint256 constant CommonTokenOffset = 0x20;
uint256 constant CommonIdentifierOffset = 0x20;
uint256 constant CommonAmountOffset = 0x20;

uint256 constant OneWord = 0x20;
uint256 constant TwoWords = 0x40;
uint256 constant ThreeWords = 0x60;

uint256 constant DefaultFreeMemoryPointer = 0x80;


uint256 constant BasicOrder_endAmount_cdPtr = 0x104;

uint256 constant BasicOrder_considerationHashesArray_ptr = 0x160;

uint256 constant EIP712_OfferItem_size = 0xc0;
uint256 constant EIP712_ConsiderationItem_size = 0xe0;
uint256 constant AdditionalRecipients_size = 0x40;
uint256 constant ReceivedItem_size = 0xa0;

uint256 constant receivedItemsHash_ptr = 0x60;

uint256 constant ReceivedItem_amount_offset = 0x60;

// BasicOrderParameters
uint256 constant BasicOrder_considerationToken_cdPtr = 0x24;
uint256 constant BasicOrder_considerationIdentifier_cdPtr = 0x44;
uint256 constant BasicOrder_considerationAmount_cdPtr = 0x64;
uint256 constant BasicOrder_offerer_cdPtr = 0x84;
uint256 constant BasicOrder_zone_cdPtr = 0xa4;
uint256 constant BasicOrder_offerToken_cdPtr = 0xc4;
uint256 constant BasicOrder_offerIdentifier_cdPtr = 0xe4;
uint256 constant BasicOrder_offerAmount_cdPtr = 0x104;
uint256 constant BasicOrder_basicOrderType_cdPtr = 0x124;
uint256 constant BasicOrder_startTime_cdPtr = 0x144;
uint256 constant BasicOrder_endTime_cdPtr = 0x164;
uint256 constant BasicOrder_zoneHash_cdPtr = 0x184;
uint256 constant BasicOrder_salt_cdPtr = 0x1a4;
uint256 constant BasicOrder_offererConduit_cdPtr = 0x1c4;
uint256 constant BasicOrder_fulfillerConduit_cdPtr = 0x1e4;
uint256 constant BasicOrder_totalOriginalAdditionalRecipients_cdPtr = 0x204;
uint256 constant BasicOrder_additionalRecipients_cdPtr = 0x224;
uint256 constant BasicOrder_signature_cdPtr = 0x244;
uint256 constant BasicOrder_additionalRecipients_length_cdPtr = 0x264;
uint256 constant BasicOrder_additionalRecipients_data_cdPtr = 0x284;

/*
 *  Memory layout in _prepareBasicFulfillmentFromCalldata of
 *  EIP712 data for ConsiderationItem
 *   - 0x80: ConsiderationItem EIP-712 typehash (constant)
 *   - 0xa0: itemType
 *   - 0xc0: token
 *   - 0xe0: identifier
 *   - 0x100: startAmount
 *   - 0x120: endAmount
 *   - 0x140: recipient
 */
uint256 constant BasicOrder_considerationItem_typeHash_ptr = DefaultFreeMemoryPointer;
uint256 constant BasicOrder_considerationItem_itemType_ptr = 0xa0;
uint256 constant BasicOrder_considerationItem_token_ptr = 0xc0;
uint256 constant BasicOrder_considerationItem_identifier_ptr = 0xe0;
uint256 constant BasicOrder_considerationItem_startAmount_ptr = 0x100;
uint256 constant BasicOrder_considerationItem_endAmount_ptr = 0x120;
uint256 constant BasicOrder_considerationItem_recipient_ptr = 0x140;

/*
 *  Memory layout in _prepareBasicFulfillmentFromCalldata of
 * EIP712 data for OfferItem
 *   - 0x80:  OfferItem EIP-712 typehash (constant)
 *   - 0xa0:  itemType
 *   - 0xc0:  token
 *   - 0xe0:  identifier (reused for offeredItemsHash)
 *   - 0x100: startAmount
 *   - 0x120: endAmount
 */
uint256 constant BasicOrder_offerItem_typeHash_ptr = DefaultFreeMemoryPointer;
uint256 constant BasicOrder_offerItem_itemType_ptr = 0xa0;
uint256 constant BasicOrder_offerItem_token_ptr = 0xc0;
uint256 constant BasicOrder_offerItem_identifier_ptr = 0xe0;
uint256 constant BasicOrder_offerItem_startAmount_ptr = 0x100;
uint256 constant BasicOrder_offerItem_endAmount_ptr = 0x120;

/*
 *  Memory layout in _prepareBasicFulfillmentFromCalldata of
 *  EIP712 data for Order
 *   - 0x80:   Order EIP-712 typehash (constant)
 *   - 0xa0:   orderParameters.offerer
 *   - 0xc0:   orderParameters.zone
 *   - 0xe0:   keccak256(abi.encodePacked(offerHashes))
 *   - 0x100:  keccak256(abi.encodePacked(considerationHashes))
 *   - 0x120:  orderParameters.basicOrderType (% 4 = orderType)
 *   - 0x140:  orderParameters.startTime
 *   - 0x160:  orderParameters.endTime
 *   - 0x180:  orderParameters.zoneHash
 *   - 0x1a0:  orderParameters.salt
 *   - 0x1c0:  orderParameters.conduit
 *   - 0x1e0:  _nonces[orderParameters.offerer] (from storage)
 */

uint256 constant BasicOrder_order_typeHash = 0x80;
uint256 constant BasicOrder_order_offerer = 0xa0;
uint256 constant BasicOrder_order_zone = 0xc0;
uint256 constant BasicOrder_order_offerHashes = 0xe0;
uint256 constant BasicOrder_order_considerationHashes = 0x100;
uint256 constant BasicOrder_order_basicOrderType = 0x120;
uint256 constant BasicOrder_order_startTime = 0x140;
uint256 constant BasicOrder_order_endTime = 0x160;
uint256 constant BasicOrder_order_zoneHash = 0x180;
uint256 constant BasicOrder_order_salt = 0x1a0;
uint256 constant BasicOrder_order_conduit = 0x1c0;
uint256 constant BasicOrder_order_nonce = 0x1e0;