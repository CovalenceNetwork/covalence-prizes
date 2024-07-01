// PrizeContractFHE.sol
// SPDX-License-Identifier: MIT
pragma solidity >=0.8.13 <0.9.0;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@fhenixprotocol/contracts/FHE.sol";
import {Permissioned, Permission} from "@fhenixprotocol/contracts/access/Permissioned.sol";
import {IAllocationStrategyFHE} from "./interfaces/IAllocationStrategyFHE.sol";

contract PrizeContractFHE is AccessControl, Permissioned {
  struct Contribution {
    address contestant;
    string description;
    euint32[] scores;
    euint32 reward;
    bool claimed;
  }

  enum State {
    Setup,
    Open,
    Evaluating,
    Rewarding,
    Closed,
    Cancelled
  }

  bytes32 public constant EVALUATOR_ROLE = keccak256("EVALUATOR_ROLE");

  address public organizer;
  string public description;
  euint32 public monetaryRewardPool;
  State public state;
  string[] public criteriaNames;
  euint32[] public criteriaWeights;
  address[] public evaluators;
  mapping(address => Contribution) public contributions;
  address[] public contributionList;

  IAllocationStrategyFHE public strategy;
  uint256 public constant MAX_BATCH_SIZE = 100;

  event StateChanged(State oldState, State newState);
  event ContributionAdded(address contestant, string description);
  event ScoresAssigned(address[] contestants);
  event RewardAllocated(address contestant);
  event EvaluatorAdded(address evaluator);
  event PrizeFunded(address funder);
  event PrizeCancelled();
  event RewardClaimed(address contestant);

  modifier onlyOrganizer() {
    require(msg.sender == organizer, "Not authorized");
    _;
  }

  modifier onlyEvaluator() {
    require(hasRole(EVALUATOR_ROLE, msg.sender), "Not an evaluator");
    _;
  }

  modifier inState(State _state) {
    require(state == _state, "Invalid state");
    _;
  }

  constructor(
    address _organizer,
    string memory _description,
    uint256 _totalRewardPool,
    address _strategy,
    string[] memory _criteriaNames,
    uint256[] memory _criteriaWeights
  ) {
    require(
      _criteriaNames.length == _criteriaWeights.length,
      "Mismatching lengths"
    );

    organizer = _organizer;
    description = _description;
    monetaryRewardPool = FHE.asEuint32(_totalRewardPool);
    strategy = IAllocationStrategyFHE(_strategy);
    criteriaNames = _criteriaNames;

    criteriaWeights = new euint32[](_criteriaWeights.length);
    for (uint256 i = 0; i < _criteriaWeights.length; i++) {
      criteriaWeights[i] = FHE.asEuint32(_criteriaWeights[i]);
    }

    state = State.Setup;
    _grantRole(DEFAULT_ADMIN_ROLE, organizer);
  }

  function addEvaluators(
    address[] memory evaluatorsToAdd
  ) public onlyOrganizer inState(State.Setup) {
    require(
      evaluatorsToAdd.length <= MAX_BATCH_SIZE,
      "Batch size exceeds maximum"
    );
    for (uint256 i = 0; i < evaluatorsToAdd.length; i++) {
      require(
        !hasRole(EVALUATOR_ROLE, evaluatorsToAdd[i]),
        "Evaluator already exists"
      );
      grantRole(EVALUATOR_ROLE, evaluatorsToAdd[i]);
      evaluators.push(evaluatorsToAdd[i]);
      emit EvaluatorAdded(evaluatorsToAdd[i]);
    }
  }

  function fundPrize(
    inEuint32 calldata _encryptedAmount
  ) public onlyOrganizer inState(State.Setup) {
    euint32 encryptedAmount = FHE.asEuint32(_encryptedAmount);
    FHE.req(FHE.eq(encryptedAmount, monetaryRewardPool));
    emit PrizeFunded(msg.sender);
  }

  function submitContribution(
    string memory _description
  ) public inState(State.Open) {
    require(
      contributions[msg.sender].contestant == address(0),
      "Only one contribution per contestant permitted"
    );
    Contribution storage newContribution = contributions[msg.sender];
    newContribution.contestant = msg.sender;
    newContribution.description = _description;
    contributionList.push(msg.sender);
    emit ContributionAdded(msg.sender, _description);
  }

  function assignScores(
    address[] calldata contestants,
    inEuint32[][] calldata encryptedScores
  ) public onlyEvaluator inState(State.Evaluating) {
    require(
      contestants.length == encryptedScores.length,
      "Mismatch in input arrays"
    );
    require(contestants.length <= MAX_BATCH_SIZE, "Batch size exceeds maximum");

    for (uint256 i = 0; i < contestants.length; i++) {
      require(
        contributions[contestants[i]].contestant != address(0),
        "Invalid contestant"
      );
      require(
        encryptedScores[i].length == criteriaNames.length,
        "Invalid number of scores"
      );

      Contribution storage contribution = contributions[contestants[i]];
      contribution.scores = new euint32[](encryptedScores[i].length);
      for (uint256 j = 0; j < encryptedScores[i].length; j++) {
        contribution.scores[j] = FHE.asEuint32(encryptedScores[i][j]);
      }
    }

    emit ScoresAssigned(contestants);
  }

  function computeScoresAndAllocateRewards(
    uint256 startIndex,
    uint256 batchSize
  ) public onlyOrganizer inState(State.Rewarding) {
    require(batchSize <= MAX_BATCH_SIZE, "Batch size exceeds maximum");
    uint256 endIndex = startIndex + batchSize;
    if (endIndex > contributionList.length) {
      endIndex = contributionList.length;
    }

    address[] memory contestantsBatch = new address[](endIndex - startIndex);
    euint32[] memory scoresBatch = new euint32[](endIndex - startIndex);

    for (uint256 i = startIndex; i < endIndex; i++) {
      address contestant = contributionList[i];
      contestantsBatch[i - startIndex] = contestant;

      euint32 weightedScore = FHE.asEuint32(0);
      for (uint256 j = 0; j < criteriaWeights.length; j++) {
        weightedScore = FHE.add(
          weightedScore,
          FHE.mul(contributions[contestant].scores[j], criteriaWeights[j])
        );
      }
      scoresBatch[i - startIndex] = weightedScore;
    }

    euint32 batchRewardPool = FHE.mul(
      monetaryRewardPool,
      FHE.asEuint32(endIndex - startIndex)
    );
    batchRewardPool = FHE.div(
      batchRewardPool,
      FHE.asEuint32(contributionList.length)
    );

    euint32[] memory rewardsBatch = strategy.computeAndAllocate(
      contestantsBatch,
      batchRewardPool,
      scoresBatch
    );

    for (uint256 i = startIndex; i < endIndex; i++) {
      contributions[contributionList[i]].reward = rewardsBatch[i - startIndex];
      emit RewardAllocated(contributionList[i]);
    }
  }

  function claimReward(
    Permission calldata permission
  ) public inState(State.Closed) onlyPermitted(permission, msg.sender) {
    Contribution storage contribution = contributions[msg.sender];
    require(contribution.contestant != address(0), "No contribution found");
    require(!contribution.claimed, "Reward already claimed");

    ebool hasReward = FHE.gt(contribution.reward, FHE.asEuint32(0));
    FHE.req(hasReward);

    contribution.claimed = true;
    euint32 reward = contribution.reward;
    contribution.reward = FHE.asEuint32(0);

    uint256 plainReward = FHE.decrypt(reward);
    (bool success, ) = msg.sender.call{value: plainReward}("");
    require(success, "Transfer failed");

    emit RewardClaimed(msg.sender);
  }

  function cancelPrize() public onlyOrganizer {
    require(
      state != State.Closed && state != State.Cancelled,
      "Prize already closed or cancelled"
    );
    changeState(State.Cancelled);
    emit PrizeCancelled();
  }

  function withdrawFunds(
    Permission calldata permission
  )
    public
    onlyOrganizer
    inState(State.Cancelled)
    onlyPermitted(permission, msg.sender)
  {
    uint256 balance = address(this).balance;
    require(balance > 0, "No funds to withdraw");
    (bool success, ) = organizer.call{value: balance}("");
    require(success, "Transfer failed");
  }

  function moveToNextState() public onlyOrganizer {
    require(uint(state) < uint(State.Closed), "Cannot move to next state");
    if (state == State.Setup) {
      ebool isFunded = FHE.gte(
        FHE.asEuint32(address(this).balance),
        monetaryRewardPool
      );
      FHE.req(isFunded);
    }
    if (state == State.Evaluating) {
      require(
        allContestantsScored(),
        "All contestants must be scored before moving to Rewarding"
      );
    }
    if (state == State.Rewarding) {
      require(
        allRewardsAllocated(),
        "All rewards must be allocated before closing"
      );
    }
    changeState(State(uint(state) + 1));
  }

  function allRewardsAllocated() internal view returns (bool) {
    for (uint256 i = 0; i < contributionList.length; i++) {
      ebool hasReward = FHE.gt(
        contributions[contributionList[i]].reward,
        FHE.asEuint32(0)
      );
      if (!FHE.decrypt(hasReward)) {
        return false;
      }
    }
    return true;
  }

  function allContestantsScored() internal view returns (bool) {
    for (uint256 i = 0; i < contributionList.length; i++) {
      if (contributions[contributionList[i]].scores.length == 0) {
        return false;
      }
    }
    return true;
  }

  function changeState(State newState) private {
    State oldState = state;
    state = newState;
    emit StateChanged(oldState, newState);
  }

  function getSealedReward(
    Permission calldata permission,
    bytes32 publicKey
  )
    public
    view
    inState(State.Closed)
    onlyPermitted(permission, msg.sender)
    returns (bytes memory)
  {
    Contribution storage contribution = contributions[msg.sender];
    require(contribution.contestant != address(0), "No contribution found");
    string memory sealedString = FHE.sealoutput(contribution.reward, publicKey);
    return bytes(sealedString);
  }
}
