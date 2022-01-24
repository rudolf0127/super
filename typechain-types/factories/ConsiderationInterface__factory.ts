/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import { Contract, Signer, utils } from "ethers";
import { Provider } from "@ethersproject/providers";
import type {
  ConsiderationInterface,
  ConsiderationInterfaceInterface,
} from "../ConsiderationInterface";

const _abi = [
  {
    inputs: [],
    name: "BadContractSignature",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "token",
        type: "address",
      },
      {
        internalType: "address",
        name: "account",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
    ],
    name: "BadReturnValueFromERC20OnTransfer",
    type: "error",
  },
  {
    inputs: [],
    name: "BadSignature",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    name: "BadSignatureLength",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8",
      },
    ],
    name: "BadSignatureV",
    type: "error",
  },
  {
    inputs: [],
    name: "ConsiderationCriteriaResolverOutOfRange",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "orderIndex",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "considerationIndex",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "shortfallAmount",
        type: "uint256",
      },
    ],
    name: "ConsiderationNotMet",
    type: "error",
  },
  {
    inputs: [],
    name: "CriteriaNotEnabledForConsideredAsset",
    type: "error",
  },
  {
    inputs: [],
    name: "CriteriaNotEnabledForOfferedAsset",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "token",
        type: "address",
      },
      {
        internalType: "address",
        name: "account",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "identifier",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
    ],
    name: "ERC1155TransferGenericFailure",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    name: "ERC1155TransferNoContract",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "token",
        type: "address",
      },
      {
        internalType: "address",
        name: "account",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
    ],
    name: "ERC20TransferGenericFailure",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    name: "ERC20TransferNoContract",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "token",
        type: "address",
      },
      {
        internalType: "address",
        name: "account",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "identifier",
        type: "uint256",
      },
    ],
    name: "ERC721TransferGenericFailure",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    name: "ERC721TransferNoContract",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "account",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
    ],
    name: "EtherTransferGenericFailure",
    type: "error",
  },
  {
    inputs: [],
    name: "FulfilledOrderIndexOutOfRange",
    type: "error",
  },
  {
    inputs: [],
    name: "FulfilledOrderOfferIndexOutOfRange",
    type: "error",
  },
  {
    inputs: [],
    name: "FulfillmentOrderConsiderationIndexOutOfRange",
    type: "error",
  },
  {
    inputs: [],
    name: "FulfillmentOrderIndexOutOfRange",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidProof",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidSignature",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidSubmitterOnRestrictedOrder",
    type: "error",
  },
  {
    inputs: [],
    name: "InvalidTime",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    name: "MalleableSignatureS",
    type: "error",
  },
  {
    inputs: [],
    name: "MismatchedFulfillmentConsiderationComponents",
    type: "error",
  },
  {
    inputs: [],
    name: "MismatchedFulfillmentOfferComponents",
    type: "error",
  },
  {
    inputs: [],
    name: "NoConsiderationOnFulfillment",
    type: "error",
  },
  {
    inputs: [],
    name: "NoConsiderationWithCriteriaOnBasicMatch",
    type: "error",
  },
  {
    inputs: [],
    name: "NoOfferOnFulfillment",
    type: "error",
  },
  {
    inputs: [],
    name: "NoOffersWithCriteriaOnBasicMatch",
    type: "error",
  },
  {
    inputs: [],
    name: "OfferCriteriaResolverOutOfRange",
    type: "error",
  },
  {
    inputs: [],
    name: "OnlyOffererOrFacilitatorMayCancel",
    type: "error",
  },
  {
    inputs: [],
    name: "OnlyOffererOrFacilitatorMayIncrementNonce",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32",
      },
    ],
    name: "OrderUsed",
    type: "error",
  },
  {
    inputs: [],
    name: "Overfill",
    type: "error",
  },
  {
    inputs: [],
    name: "PartialFillsNotEnabledForOrder",
    type: "error",
  },
  {
    inputs: [],
    name: "UnresolvedConsiderationCriteria",
    type: "error",
  },
  {
    inputs: [],
    name: "UnresolvedOfferCriteria",
    type: "error",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "offerer",
        type: "address",
      },
      {
        indexed: false,
        internalType: "address",
        name: "facilitator",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "nonce",
        type: "uint256",
      },
    ],
    name: "FacilitatorNonceIncremented",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "bytes32",
        name: "orderHash",
        type: "bytes32",
      },
      {
        indexed: true,
        internalType: "address",
        name: "offerer",
        type: "address",
      },
      {
        indexed: false,
        internalType: "address",
        name: "facilitator",
        type: "address",
      },
    ],
    name: "OrderCancelled",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "bytes32",
        name: "orderHash",
        type: "bytes32",
      },
      {
        indexed: true,
        internalType: "address",
        name: "offerer",
        type: "address",
      },
      {
        indexed: false,
        internalType: "address",
        name: "facilitator",
        type: "address",
      },
    ],
    name: "OrderFulfilled",
    type: "event",
  },
  {
    inputs: [],
    name: "DOMAIN_SEPARATOR",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: "address",
            name: "offerer",
            type: "address",
          },
          {
            internalType: "address",
            name: "facilitator",
            type: "address",
          },
          {
            internalType: "enum OrderType",
            name: "orderType",
            type: "uint8",
          },
          {
            internalType: "uint256",
            name: "startTime",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "endTime",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "salt",
            type: "uint256",
          },
          {
            components: [
              {
                internalType: "enum AssetType",
                name: "assetType",
                type: "uint8",
              },
              {
                internalType: "address",
                name: "token",
                type: "address",
              },
              {
                internalType: "uint256",
                name: "identifierOrCriteria",
                type: "uint256",
              },
              {
                internalType: "uint256",
                name: "amount",
                type: "uint256",
              },
            ],
            internalType: "struct Asset[]",
            name: "offer",
            type: "tuple[]",
          },
          {
            components: [
              {
                internalType: "enum AssetType",
                name: "assetType",
                type: "uint8",
              },
              {
                internalType: "address",
                name: "token",
                type: "address",
              },
              {
                internalType: "uint256",
                name: "identifierOrCriteria",
                type: "uint256",
              },
              {
                internalType: "uint256",
                name: "amount",
                type: "uint256",
              },
              {
                internalType: "address payable",
                name: "account",
                type: "address",
              },
            ],
            internalType: "struct ReceivedAsset[]",
            name: "consideration",
            type: "tuple[]",
          },
          {
            internalType: "uint256",
            name: "nonce",
            type: "uint256",
          },
        ],
        internalType: "struct OrderComponents[]",
        name: "orders",
        type: "tuple[]",
      },
    ],
    name: "cancel",
    outputs: [
      {
        internalType: "bool",
        name: "ok",
        type: "bool",
      },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "offerer",
        type: "address",
      },
      {
        internalType: "address",
        name: "facilitator",
        type: "address",
      },
    ],
    name: "facilitatorNonce",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          {
            components: [
              {
                internalType: "address",
                name: "offerer",
                type: "address",
              },
              {
                internalType: "address",
                name: "facilitator",
                type: "address",
              },
              {
                internalType: "enum OrderType",
                name: "orderType",
                type: "uint8",
              },
              {
                internalType: "uint256",
                name: "startTime",
                type: "uint256",
              },
              {
                internalType: "uint256",
                name: "endTime",
                type: "uint256",
              },
              {
                internalType: "uint256",
                name: "salt",
                type: "uint256",
              },
              {
                components: [
                  {
                    internalType: "enum AssetType",
                    name: "assetType",
                    type: "uint8",
                  },
                  {
                    internalType: "address",
                    name: "token",
                    type: "address",
                  },
                  {
                    internalType: "uint256",
                    name: "identifierOrCriteria",
                    type: "uint256",
                  },
                  {
                    internalType: "uint256",
                    name: "amount",
                    type: "uint256",
                  },
                ],
                internalType: "struct Asset[]",
                name: "offer",
                type: "tuple[]",
              },
              {
                components: [
                  {
                    internalType: "enum AssetType",
                    name: "assetType",
                    type: "uint8",
                  },
                  {
                    internalType: "address",
                    name: "token",
                    type: "address",
                  },
                  {
                    internalType: "uint256",
                    name: "identifierOrCriteria",
                    type: "uint256",
                  },
                  {
                    internalType: "uint256",
                    name: "amount",
                    type: "uint256",
                  },
                  {
                    internalType: "address payable",
                    name: "account",
                    type: "address",
                  },
                ],
                internalType: "struct ReceivedAsset[]",
                name: "consideration",
                type: "tuple[]",
              },
            ],
            internalType: "struct OrderParameters",
            name: "parameters",
            type: "tuple",
          },
          {
            internalType: "bytes",
            name: "signature",
            type: "bytes",
          },
        ],
        internalType: "struct Order",
        name: "order",
        type: "tuple",
      },
    ],
    name: "fulfillOrder",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool",
      },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          {
            components: [
              {
                internalType: "address",
                name: "offerer",
                type: "address",
              },
              {
                internalType: "address",
                name: "facilitator",
                type: "address",
              },
              {
                internalType: "enum OrderType",
                name: "orderType",
                type: "uint8",
              },
              {
                internalType: "uint256",
                name: "startTime",
                type: "uint256",
              },
              {
                internalType: "uint256",
                name: "endTime",
                type: "uint256",
              },
              {
                internalType: "uint256",
                name: "salt",
                type: "uint256",
              },
              {
                components: [
                  {
                    internalType: "enum AssetType",
                    name: "assetType",
                    type: "uint8",
                  },
                  {
                    internalType: "address",
                    name: "token",
                    type: "address",
                  },
                  {
                    internalType: "uint256",
                    name: "identifierOrCriteria",
                    type: "uint256",
                  },
                  {
                    internalType: "uint256",
                    name: "amount",
                    type: "uint256",
                  },
                ],
                internalType: "struct Asset[]",
                name: "offer",
                type: "tuple[]",
              },
              {
                components: [
                  {
                    internalType: "enum AssetType",
                    name: "assetType",
                    type: "uint8",
                  },
                  {
                    internalType: "address",
                    name: "token",
                    type: "address",
                  },
                  {
                    internalType: "uint256",
                    name: "identifierOrCriteria",
                    type: "uint256",
                  },
                  {
                    internalType: "uint256",
                    name: "amount",
                    type: "uint256",
                  },
                  {
                    internalType: "address payable",
                    name: "account",
                    type: "address",
                  },
                ],
                internalType: "struct ReceivedAsset[]",
                name: "consideration",
                type: "tuple[]",
              },
            ],
            internalType: "struct OrderParameters",
            name: "parameters",
            type: "tuple",
          },
          {
            internalType: "bytes",
            name: "signature",
            type: "bytes",
          },
        ],
        internalType: "struct Order",
        name: "order",
        type: "tuple",
      },
      {
        components: [
          {
            internalType: "enum Side",
            name: "side",
            type: "uint8",
          },
          {
            internalType: "uint256",
            name: "index",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "identifier",
            type: "uint256",
          },
          {
            internalType: "bytes32[]",
            name: "criteriaProof",
            type: "bytes32[]",
          },
        ],
        internalType: "struct CriteriaResolver[]",
        name: "criteriaResolvers",
        type: "tuple[]",
      },
    ],
    name: "fulfillOrderWithCriteria",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool",
      },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          {
            components: [
              {
                internalType: "address",
                name: "offerer",
                type: "address",
              },
              {
                internalType: "address",
                name: "facilitator",
                type: "address",
              },
              {
                internalType: "enum OrderType",
                name: "orderType",
                type: "uint8",
              },
              {
                internalType: "uint256",
                name: "startTime",
                type: "uint256",
              },
              {
                internalType: "uint256",
                name: "endTime",
                type: "uint256",
              },
              {
                internalType: "uint256",
                name: "salt",
                type: "uint256",
              },
              {
                components: [
                  {
                    internalType: "enum AssetType",
                    name: "assetType",
                    type: "uint8",
                  },
                  {
                    internalType: "address",
                    name: "token",
                    type: "address",
                  },
                  {
                    internalType: "uint256",
                    name: "identifierOrCriteria",
                    type: "uint256",
                  },
                  {
                    internalType: "uint256",
                    name: "amount",
                    type: "uint256",
                  },
                ],
                internalType: "struct Asset[]",
                name: "offer",
                type: "tuple[]",
              },
              {
                components: [
                  {
                    internalType: "enum AssetType",
                    name: "assetType",
                    type: "uint8",
                  },
                  {
                    internalType: "address",
                    name: "token",
                    type: "address",
                  },
                  {
                    internalType: "uint256",
                    name: "identifierOrCriteria",
                    type: "uint256",
                  },
                  {
                    internalType: "uint256",
                    name: "amount",
                    type: "uint256",
                  },
                  {
                    internalType: "address payable",
                    name: "account",
                    type: "address",
                  },
                ],
                internalType: "struct ReceivedAsset[]",
                name: "consideration",
                type: "tuple[]",
              },
            ],
            internalType: "struct OrderParameters",
            name: "parameters",
            type: "tuple",
          },
          {
            internalType: "bytes",
            name: "signature",
            type: "bytes",
          },
        ],
        internalType: "struct Order",
        name: "order",
        type: "tuple",
      },
      {
        internalType: "uint256",
        name: "amountToFill",
        type: "uint256",
      },
    ],
    name: "fulfillPartialOrder",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool",
      },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: "address",
            name: "offerer",
            type: "address",
          },
          {
            internalType: "address",
            name: "facilitator",
            type: "address",
          },
          {
            internalType: "enum OrderType",
            name: "orderType",
            type: "uint8",
          },
          {
            internalType: "uint256",
            name: "startTime",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "endTime",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "salt",
            type: "uint256",
          },
          {
            components: [
              {
                internalType: "enum AssetType",
                name: "assetType",
                type: "uint8",
              },
              {
                internalType: "address",
                name: "token",
                type: "address",
              },
              {
                internalType: "uint256",
                name: "identifierOrCriteria",
                type: "uint256",
              },
              {
                internalType: "uint256",
                name: "amount",
                type: "uint256",
              },
            ],
            internalType: "struct Asset[]",
            name: "offer",
            type: "tuple[]",
          },
          {
            components: [
              {
                internalType: "enum AssetType",
                name: "assetType",
                type: "uint8",
              },
              {
                internalType: "address",
                name: "token",
                type: "address",
              },
              {
                internalType: "uint256",
                name: "identifierOrCriteria",
                type: "uint256",
              },
              {
                internalType: "uint256",
                name: "amount",
                type: "uint256",
              },
              {
                internalType: "address payable",
                name: "account",
                type: "address",
              },
            ],
            internalType: "struct ReceivedAsset[]",
            name: "consideration",
            type: "tuple[]",
          },
          {
            internalType: "uint256",
            name: "nonce",
            type: "uint256",
          },
        ],
        internalType: "struct OrderComponents",
        name: "order",
        type: "tuple",
      },
    ],
    name: "getOrderHash",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "offerer",
        type: "address",
      },
      {
        internalType: "address",
        name: "facilitator",
        type: "address",
      },
    ],
    name: "incrementFacilitatorNonce",
    outputs: [
      {
        internalType: "uint256",
        name: "nonce",
        type: "uint256",
      },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          {
            components: [
              {
                components: [
                  {
                    internalType: "enum AssetType",
                    name: "assetType",
                    type: "uint8",
                  },
                  {
                    internalType: "address",
                    name: "token",
                    type: "address",
                  },
                  {
                    internalType: "uint256",
                    name: "identifierOrCriteria",
                    type: "uint256",
                  },
                  {
                    internalType: "uint256",
                    name: "startAmount",
                    type: "uint256",
                  },
                  {
                    internalType: "uint256",
                    name: "endAmount",
                    type: "uint256",
                  },
                ],
                internalType: "struct AdvancedAsset[]",
                name: "offer",
                type: "tuple[]",
              },
              {
                components: [
                  {
                    internalType: "enum AssetType",
                    name: "assetType",
                    type: "uint8",
                  },
                  {
                    internalType: "address",
                    name: "token",
                    type: "address",
                  },
                  {
                    internalType: "uint256",
                    name: "identifierOrCriteria",
                    type: "uint256",
                  },
                  {
                    internalType: "uint256",
                    name: "startAmount",
                    type: "uint256",
                  },
                  {
                    internalType: "uint256",
                    name: "endAmount",
                    type: "uint256",
                  },
                  {
                    internalType: "address",
                    name: "account",
                    type: "address",
                  },
                ],
                internalType: "struct AdvancedReceivedAsset[]",
                name: "consideration",
                type: "tuple[]",
              },
              {
                internalType: "uint256",
                name: "startTime",
                type: "uint256",
              },
              {
                internalType: "uint256",
                name: "endTime",
                type: "uint256",
              },
              {
                internalType: "address",
                name: "offerer",
                type: "address",
              },
              {
                internalType: "uint256",
                name: "salt",
                type: "uint256",
              },
              {
                internalType: "address",
                name: "facilitator",
                type: "address",
              },
              {
                internalType: "uint256",
                name: "nonce",
                type: "uint256",
              },
            ],
            internalType: "struct AdvancedOrderParameters",
            name: "parameters",
            type: "tuple",
          },
          {
            internalType: "bytes",
            name: "signature",
            type: "bytes",
          },
        ],
        internalType: "struct AdvancedOrder[]",
        name: "orders",
        type: "tuple[]",
      },
      {
        components: [
          {
            internalType: "uint256",
            name: "identifier",
            type: "uint256",
          },
          {
            components: [
              {
                internalType: "uint256",
                name: "orderIndex",
                type: "uint256",
              },
              {
                internalType: "uint256",
                name: "assetIndex",
                type: "uint256",
              },
              {
                internalType: "bytes32[]",
                name: "criteriaProof",
                type: "bytes32[]",
              },
            ],
            internalType: "struct AdvancedFulfillmentComponent[]",
            name: "offerComponents",
            type: "tuple[]",
          },
          {
            components: [
              {
                internalType: "uint256",
                name: "orderIndex",
                type: "uint256",
              },
              {
                internalType: "uint256",
                name: "assetIndex",
                type: "uint256",
              },
              {
                internalType: "bytes32[]",
                name: "criteriaProof",
                type: "bytes32[]",
              },
            ],
            internalType: "struct AdvancedFulfillmentComponent[]",
            name: "considerationComponents",
            type: "tuple[]",
          },
        ],
        internalType: "struct AdvancedFulfillment[]",
        name: "fulfillments",
        type: "tuple[]",
      },
    ],
    name: "matchAdvancedOrders",
    outputs: [
      {
        components: [
          {
            components: [
              {
                internalType: "enum AssetType",
                name: "assetType",
                type: "uint8",
              },
              {
                internalType: "address",
                name: "token",
                type: "address",
              },
              {
                internalType: "uint256",
                name: "identifierOrCriteria",
                type: "uint256",
              },
              {
                internalType: "uint256",
                name: "amount",
                type: "uint256",
              },
              {
                internalType: "address payable",
                name: "account",
                type: "address",
              },
            ],
            internalType: "struct ReceivedAsset",
            name: "asset",
            type: "tuple",
          },
          {
            internalType: "address",
            name: "offerer",
            type: "address",
          },
        ],
        internalType: "struct Execution[]",
        name: "",
        type: "tuple[]",
      },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          {
            components: [
              {
                internalType: "address",
                name: "offerer",
                type: "address",
              },
              {
                internalType: "address",
                name: "facilitator",
                type: "address",
              },
              {
                internalType: "enum OrderType",
                name: "orderType",
                type: "uint8",
              },
              {
                internalType: "uint256",
                name: "startTime",
                type: "uint256",
              },
              {
                internalType: "uint256",
                name: "endTime",
                type: "uint256",
              },
              {
                internalType: "uint256",
                name: "salt",
                type: "uint256",
              },
              {
                components: [
                  {
                    internalType: "enum AssetType",
                    name: "assetType",
                    type: "uint8",
                  },
                  {
                    internalType: "address",
                    name: "token",
                    type: "address",
                  },
                  {
                    internalType: "uint256",
                    name: "identifierOrCriteria",
                    type: "uint256",
                  },
                  {
                    internalType: "uint256",
                    name: "amount",
                    type: "uint256",
                  },
                ],
                internalType: "struct Asset[]",
                name: "offer",
                type: "tuple[]",
              },
              {
                components: [
                  {
                    internalType: "enum AssetType",
                    name: "assetType",
                    type: "uint8",
                  },
                  {
                    internalType: "address",
                    name: "token",
                    type: "address",
                  },
                  {
                    internalType: "uint256",
                    name: "identifierOrCriteria",
                    type: "uint256",
                  },
                  {
                    internalType: "uint256",
                    name: "amount",
                    type: "uint256",
                  },
                  {
                    internalType: "address payable",
                    name: "account",
                    type: "address",
                  },
                ],
                internalType: "struct ReceivedAsset[]",
                name: "consideration",
                type: "tuple[]",
              },
            ],
            internalType: "struct OrderParameters",
            name: "parameters",
            type: "tuple",
          },
          {
            internalType: "bytes",
            name: "signature",
            type: "bytes",
          },
        ],
        internalType: "struct Order[]",
        name: "orders",
        type: "tuple[]",
      },
      {
        components: [
          {
            components: [
              {
                internalType: "uint256",
                name: "orderIndex",
                type: "uint256",
              },
              {
                internalType: "uint256",
                name: "assetIndex",
                type: "uint256",
              },
            ],
            internalType: "struct FulfillmentComponent[]",
            name: "offerComponents",
            type: "tuple[]",
          },
          {
            components: [
              {
                internalType: "uint256",
                name: "orderIndex",
                type: "uint256",
              },
              {
                internalType: "uint256",
                name: "assetIndex",
                type: "uint256",
              },
            ],
            internalType: "struct FulfillmentComponent[]",
            name: "considerationComponents",
            type: "tuple[]",
          },
        ],
        internalType: "struct Fulfillment[]",
        name: "fulfillments",
        type: "tuple[]",
      },
    ],
    name: "matchOrders",
    outputs: [
      {
        components: [
          {
            components: [
              {
                internalType: "enum AssetType",
                name: "assetType",
                type: "uint8",
              },
              {
                internalType: "address",
                name: "token",
                type: "address",
              },
              {
                internalType: "uint256",
                name: "identifierOrCriteria",
                type: "uint256",
              },
              {
                internalType: "uint256",
                name: "amount",
                type: "uint256",
              },
              {
                internalType: "address payable",
                name: "account",
                type: "address",
              },
            ],
            internalType: "struct ReceivedAsset",
            name: "asset",
            type: "tuple",
          },
          {
            internalType: "address",
            name: "offerer",
            type: "address",
          },
        ],
        internalType: "struct Execution[]",
        name: "",
        type: "tuple[]",
      },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [],
    name: "name",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "orderHash",
        type: "bytes32",
      },
    ],
    name: "orderUsedOrCancelled",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "version",
    outputs: [
      {
        internalType: "string",
        name: "",
        type: "string",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
];

export class ConsiderationInterface__factory {
  static readonly abi = _abi;
  static createInterface(): ConsiderationInterfaceInterface {
    return new utils.Interface(_abi) as ConsiderationInterfaceInterface;
  }
  static connect(
    address: string,
    signerOrProvider: Signer | Provider
  ): ConsiderationInterface {
    return new Contract(
      address,
      _abi,
      signerOrProvider
    ) as ConsiderationInterface;
  }
}
