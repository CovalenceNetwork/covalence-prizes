// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import "@fhenixprotocol/contracts/FHE.sol";
import "../libraries/LibAppStorage.sol";
import "../interfaces/IPrizeCore.sol";
import "../interfaces/IAllocationStrategy.sol";

contract PrizeCoreFacet is IPrizeCore, AccessControlEnumerable {
    bytes32 public constant EVALUATOR_ROLE = keccak256("EVALUATOR");

    function initialize(address _admin) external override {
        require(getRoleMemberCount(DEFAULT_ADMIN_ROLE) == 0, "Already initialized");
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _setRoleAdmin(EVALUATOR_ROLE, DEFAULT_ADMIN_ROLE);
    }

    function getState() external view override returns (State) {
        return LibAppStorage.diamondStorage().state;
    }

    function moveToNextState() external override onlyRole(DEFAULT_ADMIN_ROLE) {
        AppStorage storage s = LibAppStorage.diamondStorage();
        State newState;

        if (s.state == State.Setup) newState = State.Open;
        else if (s.state == State.Open) newState = State.Evaluating;
        else if (s.state == State.Evaluating) newState = State.Rewarding;
        else if (s.state == State.Rewarding) newState = State.Closed;
        else revert("Cannot move to next state");

        State oldState = s.state;
        s.state = newState;
        emit StateChanged(oldState, newState);
    }

    function getPrizeDetails()
        external
        view
        override
        returns (
            address organizer,
            string memory name,
            string memory description,
            uint256 monetaryRewardPool,
            State state,
            string[] memory criteriaNames,
            uint32[] memory criteriaWeights,
            uint256 contributionCount,
            IAllocationStrategy allocationStrategy
        )
    {
        AppStorage storage s = LibAppStorage.diamondStorage();
        return (
            s.organizer,
            s.name,
            s.description,
            s.monetaryRewardPool,
            s.state,
            s.criteriaNames,
            s.criteriaWeights,
            s.contributionCount,
            s.strategy
        );
    }

    function getOrganizer() external view override returns (address) {
        return LibAppStorage.diamondStorage().organizer;
    }

    function getName() external view override returns (string memory) {
        return LibAppStorage.diamondStorage().name;
    }

    function getDescription() external view override returns (string memory) {
        return LibAppStorage.diamondStorage().description;
    }

    function getMonetaryRewardPool() external view override returns (uint256) {
        return LibAppStorage.diamondStorage().monetaryRewardPool;
    }

    function getCriteriaNames() external view override returns (string[] memory) {
        return LibAppStorage.diamondStorage().criteriaNames;
    }

    function getCriteriaWeights() external view override returns (uint32[] memory) {
        return LibAppStorage.diamondStorage().criteriaWeights;
    }

    function getAllocationStrategy() external view override returns (IAllocationStrategy) {
        return LibAppStorage.diamondStorage().strategy;
    }

    function addEvaluators(address[] memory _evaluators) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        for (uint256 i = 0; i < _evaluators.length; i++) {
            grantRole(EVALUATOR_ROLE, _evaluators[i]);
        }
        emit EvaluatorsAdded(_evaluators);
    }

    function removeEvaluators(address[] memory _evaluators) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        for (uint256 i = 0; i < _evaluators.length; i++) {
            revokeRole(EVALUATOR_ROLE, _evaluators[i]);
        }
        emit EvaluatorsRemoved(_evaluators);
    }

    function isEvaluator(address _account) external view override returns (bool) {
        return hasRole(EVALUATOR_ROLE, _account);
    }

    function assignCriteriaWeights(uint32[] calldata weights) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        AppStorage storage s = LibAppStorage.diamondStorage();
        require(s.state == State.Setup, "Can only assign weights during setup");
        require(weights.length == s.criteriaNames.length, "Mismatch in number of weights");

        s.criteriaWeights = weights;
        emit CriteriaWeightsAssigned(weights);
    }

    function fundPrize() external payable override onlyRole(DEFAULT_ADMIN_ROLE) {
        AppStorage storage s = LibAppStorage.diamondStorage();
        require(msg.value > 0, "Must send a positive amount");
        require(s.state == State.Setup, "Can only fund during setup");

        s.monetaryRewardPool += msg.value;
        if (s.state == State.Setup) {
            s.state = State.Open;
            emit StateChanged(State.Setup, State.Open);
        }
        emit PrizeFunded(msg.sender, msg.value, s.monetaryRewardPool);
    }

    function setAllocationStrategy(address _strategyAddress) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        AppStorage storage s = LibAppStorage.diamondStorage();
        s.strategy = IAllocationStrategy(_strategyAddress);
        emit AllocationStrategySet(_strategyAddress);
    }
}