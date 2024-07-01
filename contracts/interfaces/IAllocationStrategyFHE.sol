// IAllocationStrategyFHE.sol
// SPDX-License-Identifier: MIT
pragma solidity >=0.8.13 <0.9.0;

import "@fhenixprotocol/contracts/FHE.sol";

interface IAllocationStrategyFHE {
  function computeAndAllocate(
    address[] memory contestants,
    euint32 totalReward,
    euint32[] memory scores
  ) external view returns (euint32[] memory);
}
