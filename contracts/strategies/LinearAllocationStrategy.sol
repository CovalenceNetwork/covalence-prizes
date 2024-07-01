// LinearAllocationStrategy.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../interfaces/IAllocationStrategy.sol";

/**
 * @title LinearAllocation
 * @dev Implements a linear allocation strategy for reward distribution.
 *
 * This strategy allocates rewards linearly proportional to the weighted sum of scores
 * for each contribution. The linearity ensures that the reward amount increases
 * directly with the increase in the weighted score.
 */
contract LinearAllocation is IAllocationStrategy {
  function computeAndAllocate(
    address[] memory contestants,
    uint256 totalReward,
    uint256[] memory scores
  ) external pure override returns (uint256[] memory) {
    require(contestants.length > 0, "No contestants provided");
    require(
      contestants.length == scores.length,
      "Contestants and scores mismatch"
    );

    uint256[] memory rewards = new uint256[](contestants.length);
    uint256 totalScore = 0;

    // Calculate total score
    for (uint256 i = 0; i < scores.length; i++) {
      totalScore += scores[i];
    }

    // Allocate rewards linearly based on scores
    if (totalScore > 0) {
      for (uint256 i = 0; i < contestants.length; i++) {
        rewards[i] = (totalReward * scores[i]) / totalScore;
      }
    }

    return rewards;
  }
}
