// PrizeManager.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./PrizeContract.sol";
import "./StrategyRegistry/StrategyRegistry.sol";

contract PrizeManager {
  struct Prize {
    address prizeAddress;
    string description;
    uint256 totalRewardPool;
  }

  mapping(address => Prize[]) public prizesByOrganizer;
  address[] public allPrizes;

  StrategyRegistry public strategyRegistry;

  event PrizeCreated(
    address prizeAddress,
    string description,
    uint256 totalRewardPool,
    string allocationStrategy,
    string[] criteriaNames,
    uint256[] criteriaWeights
  );

  error InvalidTotalRewardPool();
  error EmptyDescription();
  error MismatchedCriteriaAndWeights();
  error InvalidAllocationStrategy();

  constructor(address registryAddress) {
    strategyRegistry = StrategyRegistry(registryAddress);
  }

  function createPrize(
    string memory description,
    uint256 totalRewardPool,
    string memory allocationStrategy,
    string[] memory criteriaNames,
    uint256[] memory criteriaWeights
  ) public returns (address) {
    if (totalRewardPool == 0) revert InvalidTotalRewardPool();
    if (bytes(description).length == 0) revert EmptyDescription();
    if (criteriaNames.length != criteriaWeights.length)
      revert MismatchedCriteriaAndWeights();

    address allocationStrategyAddress = strategyRegistry.getStrategyAddress(
      allocationStrategy
    );
    if (allocationStrategyAddress == address(0))
      revert InvalidAllocationStrategy();

    PrizeContract newPrize = new PrizeContract(
      msg.sender,
      description,
      totalRewardPool,
      allocationStrategyAddress,
      criteriaNames,
      criteriaWeights
    );

    address newPrizeAddress = address(newPrize);

    prizesByOrganizer[msg.sender].push(
      Prize(newPrizeAddress, description, totalRewardPool)
    );
    allPrizes.push(newPrizeAddress);

    emit PrizeCreated(
      newPrizeAddress,
      description,
      totalRewardPool,
      allocationStrategy,
      criteriaNames,
      criteriaWeights
    );

    return newPrizeAddress;
  }

  function getPrizesByOrganizer(
    address organizer
  ) public view returns (Prize[] memory) {
    return prizesByOrganizer[organizer];
  }

  function getAllPrizes() public view returns (Prize[] memory) {
    Prize[] memory allPrizesArray = new Prize[](allPrizes.length);
    for (uint i = 0; i < allPrizes.length; i++) {
      address prizeAddress = allPrizes[i];
      for (uint j = 0; j < prizesByOrganizer[msg.sender].length; j++) {
        if (prizesByOrganizer[msg.sender][j].prizeAddress == prizeAddress) {
          allPrizesArray[i] = prizesByOrganizer[msg.sender][j];
          break;
        }
      }
    }
    return allPrizesArray;
  }
}
