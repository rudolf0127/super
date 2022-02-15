/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */
import {
  BaseContract,
  BigNumber,
  BigNumberish,
  BytesLike,
  CallOverrides,
  ContractTransaction,
  Overrides,
  PayableOverrides,
  PopulatedTransaction,
  Signer,
  utils,
} from "ethers";
import { FunctionFragment, Result, EventFragment } from "@ethersproject/abi";
import { Listener, Provider } from "@ethersproject/providers";
import { TypedEventFilter, TypedEvent, TypedListener, OnEvent } from "./common";

export type OfferedAssetStruct = {
  assetType: BigNumberish;
  token: string;
  identifierOrCriteria: BigNumberish;
  startAmount: BigNumberish;
  endAmount: BigNumberish;
};

export type OfferedAssetStructOutput = [
  number,
  string,
  BigNumber,
  BigNumber,
  BigNumber
] & {
  assetType: number;
  token: string;
  identifierOrCriteria: BigNumber;
  startAmount: BigNumber;
  endAmount: BigNumber;
};

export type ReceivedAssetStruct = {
  assetType: BigNumberish;
  token: string;
  identifierOrCriteria: BigNumberish;
  startAmount: BigNumberish;
  endAmount: BigNumberish;
  account: string;
};

export type ReceivedAssetStructOutput = [
  number,
  string,
  BigNumber,
  BigNumber,
  BigNumber,
  string
] & {
  assetType: number;
  token: string;
  identifierOrCriteria: BigNumber;
  startAmount: BigNumber;
  endAmount: BigNumber;
  account: string;
};

export type OrderComponentsStruct = {
  offerer: string;
  facilitator: string;
  orderType: BigNumberish;
  startTime: BigNumberish;
  endTime: BigNumberish;
  salt: BigNumberish;
  offer: OfferedAssetStruct[];
  consideration: ReceivedAssetStruct[];
  nonce: BigNumberish;
};

export type OrderComponentsStructOutput = [
  string,
  string,
  number,
  BigNumber,
  BigNumber,
  BigNumber,
  OfferedAssetStructOutput[],
  ReceivedAssetStructOutput[],
  BigNumber
] & {
  offerer: string;
  facilitator: string;
  orderType: number;
  startTime: BigNumber;
  endTime: BigNumber;
  salt: BigNumber;
  offer: OfferedAssetStructOutput[];
  consideration: ReceivedAssetStructOutput[];
  nonce: BigNumber;
};

export type OrderParametersStruct = {
  offerer: string;
  facilitator: string;
  orderType: BigNumberish;
  startTime: BigNumberish;
  endTime: BigNumberish;
  salt: BigNumberish;
  offer: OfferedAssetStruct[];
  consideration: ReceivedAssetStruct[];
};

export type OrderParametersStructOutput = [
  string,
  string,
  number,
  BigNumber,
  BigNumber,
  BigNumber,
  OfferedAssetStructOutput[],
  ReceivedAssetStructOutput[]
] & {
  offerer: string;
  facilitator: string;
  orderType: number;
  startTime: BigNumber;
  endTime: BigNumber;
  salt: BigNumber;
  offer: OfferedAssetStructOutput[];
  consideration: ReceivedAssetStructOutput[];
};

export type OrderStruct = {
  parameters: OrderParametersStruct;
  signature: BytesLike;
};

export type OrderStructOutput = [OrderParametersStructOutput, string] & {
  parameters: OrderParametersStructOutput;
  signature: string;
};

export type CriteriaResolverStruct = {
  orderIndex: BigNumberish;
  side: BigNumberish;
  index: BigNumberish;
  identifier: BigNumberish;
  criteriaProof: BytesLike[];
};

export type CriteriaResolverStructOutput = [
  BigNumber,
  number,
  BigNumber,
  BigNumber,
  string[]
] & {
  orderIndex: BigNumber;
  side: number;
  index: BigNumber;
  identifier: BigNumber;
  criteriaProof: string[];
};

export type OrderStatusStruct = {
  isValidated: boolean;
  isCancelled: boolean;
  numerator: BigNumberish;
  denominator: BigNumberish;
};

export type OrderStatusStructOutput = [
  boolean,
  boolean,
  BigNumber,
  BigNumber
] & {
  isValidated: boolean;
  isCancelled: boolean;
  numerator: BigNumber;
  denominator: BigNumber;
};

export type FulfillmentComponentStruct = {
  orderIndex: BigNumberish;
  assetIndex: BigNumberish;
};

export type FulfillmentComponentStructOutput = [BigNumber, BigNumber] & {
  orderIndex: BigNumber;
  assetIndex: BigNumber;
};

export type FulfillmentStruct = {
  offerComponents: FulfillmentComponentStruct[];
  considerationComponents: FulfillmentComponentStruct[];
};

export type FulfillmentStructOutput = [
  FulfillmentComponentStructOutput[],
  FulfillmentComponentStructOutput[]
] & {
  offerComponents: FulfillmentComponentStructOutput[];
  considerationComponents: FulfillmentComponentStructOutput[];
};

export type ExecutionStruct = { asset: ReceivedAssetStruct; offerer: string };

export type ExecutionStructOutput = [ReceivedAssetStructOutput, string] & {
  asset: ReceivedAssetStructOutput;
  offerer: string;
};

export interface ConsiderationInterface extends utils.Interface {
  contractName: "Consideration";
  functions: {
    "DOMAIN_SEPARATOR()": FunctionFragment;
    "cancel((address,address,uint8,uint256,uint256,uint256,(uint8,address,uint256,uint256,uint256)[],(uint8,address,uint256,uint256,uint256,address)[],uint256)[])": FunctionFragment;
    "facilitatorNonce(address,address)": FunctionFragment;
    "fulfillOrder(((address,address,uint8,uint256,uint256,uint256,(uint8,address,uint256,uint256,uint256)[],(uint8,address,uint256,uint256,uint256,address)[]),bytes))": FunctionFragment;
    "fulfillOrderWithCriteria(((address,address,uint8,uint256,uint256,uint256,(uint8,address,uint256,uint256,uint256)[],(uint8,address,uint256,uint256,uint256,address)[]),bytes),(uint256,uint8,uint256,uint256,bytes32[])[])": FunctionFragment;
    "fulfillPartialOrder(((address,address,uint8,uint256,uint256,uint256,(uint8,address,uint256,uint256,uint256)[],(uint8,address,uint256,uint256,uint256,address)[]),bytes),uint120,uint120)": FunctionFragment;
    "getOrderHash((address,address,uint8,uint256,uint256,uint256,(uint8,address,uint256,uint256,uint256)[],(uint8,address,uint256,uint256,uint256,address)[],uint256))": FunctionFragment;
    "getOrderStatus(bytes32)": FunctionFragment;
    "incrementFacilitatorNonce(address,address)": FunctionFragment;
    "matchOrders(((address,address,uint8,uint256,uint256,uint256,(uint8,address,uint256,uint256,uint256)[],(uint8,address,uint256,uint256,uint256,address)[]),bytes)[],(uint256,uint8,uint256,uint256,bytes32[])[],((uint256,uint256)[],(uint256,uint256)[])[])": FunctionFragment;
    "name()": FunctionFragment;
    "validate(((address,address,uint8,uint256,uint256,uint256,(uint8,address,uint256,uint256,uint256)[],(uint8,address,uint256,uint256,uint256,address)[]),bytes)[])": FunctionFragment;
    "version()": FunctionFragment;
  };

  encodeFunctionData(
    functionFragment: "DOMAIN_SEPARATOR",
    values?: undefined
  ): string;
  encodeFunctionData(
    functionFragment: "cancel",
    values: [OrderComponentsStruct[]]
  ): string;
  encodeFunctionData(
    functionFragment: "facilitatorNonce",
    values: [string, string]
  ): string;
  encodeFunctionData(
    functionFragment: "fulfillOrder",
    values: [OrderStruct]
  ): string;
  encodeFunctionData(
    functionFragment: "fulfillOrderWithCriteria",
    values: [OrderStruct, CriteriaResolverStruct[]]
  ): string;
  encodeFunctionData(
    functionFragment: "fulfillPartialOrder",
    values: [OrderStruct, BigNumberish, BigNumberish]
  ): string;
  encodeFunctionData(
    functionFragment: "getOrderHash",
    values: [OrderComponentsStruct]
  ): string;
  encodeFunctionData(
    functionFragment: "getOrderStatus",
    values: [BytesLike]
  ): string;
  encodeFunctionData(
    functionFragment: "incrementFacilitatorNonce",
    values: [string, string]
  ): string;
  encodeFunctionData(
    functionFragment: "matchOrders",
    values: [OrderStruct[], CriteriaResolverStruct[], FulfillmentStruct[]]
  ): string;
  encodeFunctionData(functionFragment: "name", values?: undefined): string;
  encodeFunctionData(
    functionFragment: "validate",
    values: [OrderStruct[]]
  ): string;
  encodeFunctionData(functionFragment: "version", values?: undefined): string;

  decodeFunctionResult(
    functionFragment: "DOMAIN_SEPARATOR",
    data: BytesLike
  ): Result;
  decodeFunctionResult(functionFragment: "cancel", data: BytesLike): Result;
  decodeFunctionResult(
    functionFragment: "facilitatorNonce",
    data: BytesLike
  ): Result;
  decodeFunctionResult(
    functionFragment: "fulfillOrder",
    data: BytesLike
  ): Result;
  decodeFunctionResult(
    functionFragment: "fulfillOrderWithCriteria",
    data: BytesLike
  ): Result;
  decodeFunctionResult(
    functionFragment: "fulfillPartialOrder",
    data: BytesLike
  ): Result;
  decodeFunctionResult(
    functionFragment: "getOrderHash",
    data: BytesLike
  ): Result;
  decodeFunctionResult(
    functionFragment: "getOrderStatus",
    data: BytesLike
  ): Result;
  decodeFunctionResult(
    functionFragment: "incrementFacilitatorNonce",
    data: BytesLike
  ): Result;
  decodeFunctionResult(
    functionFragment: "matchOrders",
    data: BytesLike
  ): Result;
  decodeFunctionResult(functionFragment: "name", data: BytesLike): Result;
  decodeFunctionResult(functionFragment: "validate", data: BytesLike): Result;
  decodeFunctionResult(functionFragment: "version", data: BytesLike): Result;

  events: {
    "FacilitatorNonceIncremented(address,address,uint256)": EventFragment;
    "OrderCancelled(bytes32,address,address)": EventFragment;
    "OrderFulfilled(bytes32,address,address)": EventFragment;
    "OrderValidated(bytes32,address,address)": EventFragment;
  };

  getEvent(
    nameOrSignatureOrTopic: "FacilitatorNonceIncremented"
  ): EventFragment;
  getEvent(nameOrSignatureOrTopic: "OrderCancelled"): EventFragment;
  getEvent(nameOrSignatureOrTopic: "OrderFulfilled"): EventFragment;
  getEvent(nameOrSignatureOrTopic: "OrderValidated"): EventFragment;
}

export type FacilitatorNonceIncrementedEvent = TypedEvent<
  [string, string, BigNumber],
  { offerer: string; facilitator: string; nonce: BigNumber }
>;

export type FacilitatorNonceIncrementedEventFilter =
  TypedEventFilter<FacilitatorNonceIncrementedEvent>;

export type OrderCancelledEvent = TypedEvent<
  [string, string, string],
  { orderHash: string; offerer: string; facilitator: string }
>;

export type OrderCancelledEventFilter = TypedEventFilter<OrderCancelledEvent>;

export type OrderFulfilledEvent = TypedEvent<
  [string, string, string],
  { orderHash: string; offerer: string; facilitator: string }
>;

export type OrderFulfilledEventFilter = TypedEventFilter<OrderFulfilledEvent>;

export type OrderValidatedEvent = TypedEvent<
  [string, string, string],
  { orderHash: string; offerer: string; facilitator: string }
>;

export type OrderValidatedEventFilter = TypedEventFilter<OrderValidatedEvent>;

export interface Consideration extends BaseContract {
  contractName: "Consideration";
  connect(signerOrProvider: Signer | Provider | string): this;
  attach(addressOrName: string): this;
  deployed(): Promise<this>;

  interface: ConsiderationInterface;

  queryFilter<TEvent extends TypedEvent>(
    event: TypedEventFilter<TEvent>,
    fromBlockOrBlockhash?: string | number | undefined,
    toBlock?: string | number | undefined
  ): Promise<Array<TEvent>>;

  listeners<TEvent extends TypedEvent>(
    eventFilter?: TypedEventFilter<TEvent>
  ): Array<TypedListener<TEvent>>;
  listeners(eventName?: string): Array<Listener>;
  removeAllListeners<TEvent extends TypedEvent>(
    eventFilter: TypedEventFilter<TEvent>
  ): this;
  removeAllListeners(eventName?: string): this;
  off: OnEvent<this>;
  on: OnEvent<this>;
  once: OnEvent<this>;
  removeListener: OnEvent<this>;

  functions: {
    DOMAIN_SEPARATOR(overrides?: CallOverrides): Promise<[string]>;

    cancel(
      orders: OrderComponentsStruct[],
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<ContractTransaction>;

    facilitatorNonce(
      offerer: string,
      facilitator: string,
      overrides?: CallOverrides
    ): Promise<[BigNumber]>;

    fulfillOrder(
      order: OrderStruct,
      overrides?: PayableOverrides & { from?: string | Promise<string> }
    ): Promise<ContractTransaction>;

    fulfillOrderWithCriteria(
      order: OrderStruct,
      criteriaResolvers: CriteriaResolverStruct[],
      overrides?: PayableOverrides & { from?: string | Promise<string> }
    ): Promise<ContractTransaction>;

    fulfillPartialOrder(
      order: OrderStruct,
      numerator: BigNumberish,
      denominator: BigNumberish,
      overrides?: PayableOverrides & { from?: string | Promise<string> }
    ): Promise<ContractTransaction>;

    getOrderHash(
      order: OrderComponentsStruct,
      overrides?: CallOverrides
    ): Promise<[string]>;

    getOrderStatus(
      orderHash: BytesLike,
      overrides?: CallOverrides
    ): Promise<[OrderStatusStructOutput]>;

    incrementFacilitatorNonce(
      offerer: string,
      facilitator: string,
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<ContractTransaction>;

    matchOrders(
      orders: OrderStruct[],
      criteriaResolvers: CriteriaResolverStruct[],
      fulfillments: FulfillmentStruct[],
      overrides?: PayableOverrides & { from?: string | Promise<string> }
    ): Promise<ContractTransaction>;

    name(overrides?: CallOverrides): Promise<[string]>;

    validate(
      orders: OrderStruct[],
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<ContractTransaction>;

    version(overrides?: CallOverrides): Promise<[string]>;
  };

  DOMAIN_SEPARATOR(overrides?: CallOverrides): Promise<string>;

  cancel(
    orders: OrderComponentsStruct[],
    overrides?: Overrides & { from?: string | Promise<string> }
  ): Promise<ContractTransaction>;

  facilitatorNonce(
    offerer: string,
    facilitator: string,
    overrides?: CallOverrides
  ): Promise<BigNumber>;

  fulfillOrder(
    order: OrderStruct,
    overrides?: PayableOverrides & { from?: string | Promise<string> }
  ): Promise<ContractTransaction>;

  fulfillOrderWithCriteria(
    order: OrderStruct,
    criteriaResolvers: CriteriaResolverStruct[],
    overrides?: PayableOverrides & { from?: string | Promise<string> }
  ): Promise<ContractTransaction>;

  fulfillPartialOrder(
    order: OrderStruct,
    numerator: BigNumberish,
    denominator: BigNumberish,
    overrides?: PayableOverrides & { from?: string | Promise<string> }
  ): Promise<ContractTransaction>;

  getOrderHash(
    order: OrderComponentsStruct,
    overrides?: CallOverrides
  ): Promise<string>;

  getOrderStatus(
    orderHash: BytesLike,
    overrides?: CallOverrides
  ): Promise<OrderStatusStructOutput>;

  incrementFacilitatorNonce(
    offerer: string,
    facilitator: string,
    overrides?: Overrides & { from?: string | Promise<string> }
  ): Promise<ContractTransaction>;

  matchOrders(
    orders: OrderStruct[],
    criteriaResolvers: CriteriaResolverStruct[],
    fulfillments: FulfillmentStruct[],
    overrides?: PayableOverrides & { from?: string | Promise<string> }
  ): Promise<ContractTransaction>;

  name(overrides?: CallOverrides): Promise<string>;

  validate(
    orders: OrderStruct[],
    overrides?: Overrides & { from?: string | Promise<string> }
  ): Promise<ContractTransaction>;

  version(overrides?: CallOverrides): Promise<string>;

  callStatic: {
    DOMAIN_SEPARATOR(overrides?: CallOverrides): Promise<string>;

    cancel(
      orders: OrderComponentsStruct[],
      overrides?: CallOverrides
    ): Promise<boolean>;

    facilitatorNonce(
      offerer: string,
      facilitator: string,
      overrides?: CallOverrides
    ): Promise<BigNumber>;

    fulfillOrder(
      order: OrderStruct,
      overrides?: CallOverrides
    ): Promise<boolean>;

    fulfillOrderWithCriteria(
      order: OrderStruct,
      criteriaResolvers: CriteriaResolverStruct[],
      overrides?: CallOverrides
    ): Promise<boolean>;

    fulfillPartialOrder(
      order: OrderStruct,
      numerator: BigNumberish,
      denominator: BigNumberish,
      overrides?: CallOverrides
    ): Promise<boolean>;

    getOrderHash(
      order: OrderComponentsStruct,
      overrides?: CallOverrides
    ): Promise<string>;

    getOrderStatus(
      orderHash: BytesLike,
      overrides?: CallOverrides
    ): Promise<OrderStatusStructOutput>;

    incrementFacilitatorNonce(
      offerer: string,
      facilitator: string,
      overrides?: CallOverrides
    ): Promise<BigNumber>;

    matchOrders(
      orders: OrderStruct[],
      criteriaResolvers: CriteriaResolverStruct[],
      fulfillments: FulfillmentStruct[],
      overrides?: CallOverrides
    ): Promise<ExecutionStructOutput[]>;

    name(overrides?: CallOverrides): Promise<string>;

    validate(
      orders: OrderStruct[],
      overrides?: CallOverrides
    ): Promise<boolean>;

    version(overrides?: CallOverrides): Promise<string>;
  };

  filters: {
    "FacilitatorNonceIncremented(address,address,uint256)"(
      offerer?: string | null,
      facilitator?: null,
      nonce?: null
    ): FacilitatorNonceIncrementedEventFilter;
    FacilitatorNonceIncremented(
      offerer?: string | null,
      facilitator?: null,
      nonce?: null
    ): FacilitatorNonceIncrementedEventFilter;

    "OrderCancelled(bytes32,address,address)"(
      orderHash?: null,
      offerer?: string | null,
      facilitator?: null
    ): OrderCancelledEventFilter;
    OrderCancelled(
      orderHash?: null,
      offerer?: string | null,
      facilitator?: null
    ): OrderCancelledEventFilter;

    "OrderFulfilled(bytes32,address,address)"(
      orderHash?: null,
      offerer?: string | null,
      facilitator?: null
    ): OrderFulfilledEventFilter;
    OrderFulfilled(
      orderHash?: null,
      offerer?: string | null,
      facilitator?: null
    ): OrderFulfilledEventFilter;

    "OrderValidated(bytes32,address,address)"(
      orderHash?: null,
      offerer?: string | null,
      facilitator?: null
    ): OrderValidatedEventFilter;
    OrderValidated(
      orderHash?: null,
      offerer?: string | null,
      facilitator?: null
    ): OrderValidatedEventFilter;
  };

  estimateGas: {
    DOMAIN_SEPARATOR(overrides?: CallOverrides): Promise<BigNumber>;

    cancel(
      orders: OrderComponentsStruct[],
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<BigNumber>;

    facilitatorNonce(
      offerer: string,
      facilitator: string,
      overrides?: CallOverrides
    ): Promise<BigNumber>;

    fulfillOrder(
      order: OrderStruct,
      overrides?: PayableOverrides & { from?: string | Promise<string> }
    ): Promise<BigNumber>;

    fulfillOrderWithCriteria(
      order: OrderStruct,
      criteriaResolvers: CriteriaResolverStruct[],
      overrides?: PayableOverrides & { from?: string | Promise<string> }
    ): Promise<BigNumber>;

    fulfillPartialOrder(
      order: OrderStruct,
      numerator: BigNumberish,
      denominator: BigNumberish,
      overrides?: PayableOverrides & { from?: string | Promise<string> }
    ): Promise<BigNumber>;

    getOrderHash(
      order: OrderComponentsStruct,
      overrides?: CallOverrides
    ): Promise<BigNumber>;

    getOrderStatus(
      orderHash: BytesLike,
      overrides?: CallOverrides
    ): Promise<BigNumber>;

    incrementFacilitatorNonce(
      offerer: string,
      facilitator: string,
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<BigNumber>;

    matchOrders(
      orders: OrderStruct[],
      criteriaResolvers: CriteriaResolverStruct[],
      fulfillments: FulfillmentStruct[],
      overrides?: PayableOverrides & { from?: string | Promise<string> }
    ): Promise<BigNumber>;

    name(overrides?: CallOverrides): Promise<BigNumber>;

    validate(
      orders: OrderStruct[],
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<BigNumber>;

    version(overrides?: CallOverrides): Promise<BigNumber>;
  };

  populateTransaction: {
    DOMAIN_SEPARATOR(overrides?: CallOverrides): Promise<PopulatedTransaction>;

    cancel(
      orders: OrderComponentsStruct[],
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<PopulatedTransaction>;

    facilitatorNonce(
      offerer: string,
      facilitator: string,
      overrides?: CallOverrides
    ): Promise<PopulatedTransaction>;

    fulfillOrder(
      order: OrderStruct,
      overrides?: PayableOverrides & { from?: string | Promise<string> }
    ): Promise<PopulatedTransaction>;

    fulfillOrderWithCriteria(
      order: OrderStruct,
      criteriaResolvers: CriteriaResolverStruct[],
      overrides?: PayableOverrides & { from?: string | Promise<string> }
    ): Promise<PopulatedTransaction>;

    fulfillPartialOrder(
      order: OrderStruct,
      numerator: BigNumberish,
      denominator: BigNumberish,
      overrides?: PayableOverrides & { from?: string | Promise<string> }
    ): Promise<PopulatedTransaction>;

    getOrderHash(
      order: OrderComponentsStruct,
      overrides?: CallOverrides
    ): Promise<PopulatedTransaction>;

    getOrderStatus(
      orderHash: BytesLike,
      overrides?: CallOverrides
    ): Promise<PopulatedTransaction>;

    incrementFacilitatorNonce(
      offerer: string,
      facilitator: string,
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<PopulatedTransaction>;

    matchOrders(
      orders: OrderStruct[],
      criteriaResolvers: CriteriaResolverStruct[],
      fulfillments: FulfillmentStruct[],
      overrides?: PayableOverrides & { from?: string | Promise<string> }
    ): Promise<PopulatedTransaction>;

    name(overrides?: CallOverrides): Promise<PopulatedTransaction>;

    validate(
      orders: OrderStruct[],
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<PopulatedTransaction>;

    version(overrides?: CallOverrides): Promise<PopulatedTransaction>;
  };
}
