// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@fhenixprotocol/contracts/FHE.sol";
import "../libraries/LibAppStorage.sol";
import "../libraries/LibACL.sol";
import "../libraries/LibPrize.sol";

contract PrizeEvaluationFacet {
    function evaluateContribution(
        uint256 prizeId,
        uint256 contributionId,
        inEuint32[] memory encryptedScores
    ) external {
        require(LibPrize.isState(prizeId, LibPrize.State.Evaluating), "Invalid state");
        require(LibACL.isPrizeEvaluator(prizeId, msg.sender), "Caller is not an evaluator for this prize");
        AppStorage storage s = LibAppStorage.diamondStorage();
        Prize storage prize = s.prizes[prizeId];

        require(contributionId < prize.contributionCount, "Invalid contribution ID");
        Contribution storage contribution = prize.contributionsById[contributionId];

        require(encryptedScores.length == prize.criteriaWeights.length, "Invalid number of scores");
        require(
            !prize.evaluatorContestantScored[msg.sender][contribution.contestant][contributionId],
            "Contribution already scored by this evaluator"
        );

        euint32 weightedScore = FHE.asEuint32(0);
        for (uint256 j = 0; j < encryptedScores.length; j++) {
            euint32 score = FHE.asEuint32(encryptedScores[j]);
            euint32 weight = FHE.asEuint32(prize.criteriaWeights[j]);
            weightedScore = FHE.add(weightedScore, FHE.mul(score, weight));
        }

        contribution.weightedScore = FHE.add(contribution.weightedScore, weightedScore);
        contribution.evaluationCount++;
        if (!contribution.evaluated && contribution.evaluationCount == LibACL.getPrizeEvaluatorCount(prizeId)) {
            contribution.evaluated = true;
            prize.evaluatedContributionsCount++;
        }
        prize.evaluatorContestantScored[msg.sender][contribution.contestant][contributionId] = true;
        prize.totalScore = FHE.add(prize.totalScore, weightedScore);

        emit LibPrize.ScoreAssigned(prizeId, msg.sender, contribution.contestant, contributionId, encryptedScores.length);
    }

    function getEvaluationCount(uint256 prizeId, uint256 contributionId) external view returns (uint16) {
        AppStorage storage s = LibAppStorage.diamondStorage();
        Prize storage prize = s.prizes[prizeId];
        require(contributionId < prize.contributionCount, "Invalid contribution ID");
        return prize.contributionsById[contributionId].evaluationCount;
    }

    function hasEvaluatorScoredContribution(
        uint256 prizeId,
        address evaluator,
        uint256 contributionId
    ) external view returns (bool) {
        AppStorage storage s = LibAppStorage.diamondStorage();
        Prize storage prize = s.prizes[prizeId];
        require(contributionId < prize.contributionCount, "Invalid contribution ID");
        Contribution storage contribution = prize.contributionsById[contributionId];
        return prize.evaluatorContestantScored[evaluator][contribution.contestant][contributionId];
    }

    function assignCriteriaWeights(uint256 prizeId, uint16[] calldata weights) external {
        require(LibPrize.isState(prizeId, LibPrize.State.Setup), "Invalid state");
        require(LibACL.isPrizeOrganizer(prizeId, msg.sender), "Caller is not the prize organizer");
        AppStorage storage s = LibAppStorage.diamondStorage();
        Prize storage prize = s.prizes[prizeId];
        require(weights.length == prize.criteriaNames.length, "Mismatch in number of weights");

        for (uint256 i = 0; i < weights.length; i++) {
            require(weights[i] <= 10, "Weight must be <= 10");
        }

        prize.criteriaWeights = weights;
        emit LibPrize.CriteriaWeightsAssigned(prizeId, weights);
    }

    function getCriteriaWeights(uint256 prizeId) external view returns (uint16[] memory) {
        AppStorage storage s = LibAppStorage.diamondStorage();
        Prize storage prize = s.prizes[prizeId];
        return prize.criteriaWeights;
    }
}
