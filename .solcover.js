module.exports = {
  skipFiles: [
    "conduit/lib/ConduitEnums.sol",
    "conduit/lib/ConduitStructs.sol",
    "interfaces/AbridgedProxyInterfaces.sol",
    "interfaces/AbridgedTokenInterfaces.sol",
    "interfaces/ConduitControllerInterface.sol",
    "interfaces/ConduitInterface.sol",
    "interfaces/ConsiderationEventsAndErrors.sol",
    "interfaces/ConsiderationInterface.sol",
    "interfaces/EIP1271Interface.sol",
    "interfaces/ZoneInterface.sol",
    "lib/ConsiderationConstants.sol",
    "lib/ConsiderationEnums.sol",
    "lib/ConsiderationStructs.sol",
    "reference/ReferenceConsideration.sol",
    "reference/conduit/ReferenceConduit.sol",
    "reference/conduit/ReferenceConduitController.sol",
    "reference/lib/ReferenceConsiderationBase.sol",
    "reference/lib/ReferenceConsiderationInternal.sol",
    "reference/lib/ReferenceConsiderationInternalView.sol",
    "reference/lib/ReferenceConsiderationPure.sol",
    "reference/lib/ReferenceTokenTransferrer.sol",
    "test/EIP1271Wallet.sol",
    "test/ExcessReturnDataRecipient.sol",
    "test/Reenterer.sol",
    "test/TestERC1155.sol",
    "test/TestERC20.sol",
    "test/TestERC721.sol",
    "test/TestZone.sol",
  ],
  configureYulOptimizer: true,
  solcOptimizerDetails: {
    yul: true,
    yulDetails: {
      stackAllocation: true
    }
  }
};
