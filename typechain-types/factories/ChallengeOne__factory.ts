/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */
import { Signer, utils, Contract, ContractFactory, Overrides } from "ethers";
import { Provider, TransactionRequest } from "@ethersproject/providers";
import type { ChallengeOne, ChallengeOneInterface } from "../ChallengeOne";

const _abi = [
  {
    inputs: [],
    name: "InexactDivision",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "uint128",
        name: "numerator",
        type: "uint128",
      },
      {
        internalType: "uint128",
        name: "denominator",
        type: "uint128",
      },
      {
        internalType: "uint256",
        name: "value",
        type: "uint256",
      },
    ],
    name: "exactDivide",
    outputs: [
      {
        internalType: "uint256",
        name: "newValue",
        type: "uint256",
      },
    ],
    stateMutability: "pure",
    type: "function",
  },
];

const _bytecode =
  "0x608060405234801561001057600080fd5b506101ae806100206000396000f3fe608060405234801561001057600080fd5b506004361061002b5760003560e01c8063ec64c7bf14610030575b600080fd5b61004361003e3660046100ed565b610055565b60405190815260200160405180910390f35b6000826001600160801b0316846001600160801b0316836100769190610129565b6100809190610156565b9050836001600160801b0316836001600160801b0316826100a19190610129565b6100ab9190610156565b82146100ca576040516389c65fa360e01b815260040160405180910390fd5b9392505050565b80356001600160801b03811681146100e857600080fd5b919050565b60008060006060848603121561010257600080fd5b61010b846100d1565b9250610119602085016100d1565b9150604084013590509250925092565b600081600019048311821515161561015157634e487b7160e01b600052601160045260246000fd5b500290565b60008261017357634e487b7160e01b600052601260045260246000fd5b50049056fea2646970667358221220e1b7b650ded44ad17e920cb14bc305aadf6b5d09a30333f12049df2a166ed26964736f6c634300080b0033";

type ChallengeOneConstructorParams =
  | [signer?: Signer]
  | ConstructorParameters<typeof ContractFactory>;

const isSuperArgs = (
  xs: ChallengeOneConstructorParams
): xs is ConstructorParameters<typeof ContractFactory> => xs.length > 1;

export class ChallengeOne__factory extends ContractFactory {
  constructor(...args: ChallengeOneConstructorParams) {
    if (isSuperArgs(args)) {
      super(...args);
    } else {
      super(_abi, _bytecode, args[0]);
    }
    this.contractName = "ChallengeOne";
  }

  deploy(
    overrides?: Overrides & { from?: string | Promise<string> }
  ): Promise<ChallengeOne> {
    return super.deploy(overrides || {}) as Promise<ChallengeOne>;
  }
  getDeployTransaction(
    overrides?: Overrides & { from?: string | Promise<string> }
  ): TransactionRequest {
    return super.getDeployTransaction(overrides || {});
  }
  attach(address: string): ChallengeOne {
    return super.attach(address) as ChallengeOne;
  }
  connect(signer: Signer): ChallengeOne__factory {
    return super.connect(signer) as ChallengeOne__factory;
  }
  static readonly contractName: "ChallengeOne";
  public readonly contractName: "ChallengeOne";
  static readonly bytecode = _bytecode;
  static readonly abi = _abi;
  static createInterface(): ChallengeOneInterface {
    return new utils.Interface(_abi) as ChallengeOneInterface;
  }
  static connect(
    address: string,
    signerOrProvider: Signer | Provider
  ): ChallengeOne {
    return new Contract(address, _abi, signerOrProvider) as ChallengeOne;
  }
}
