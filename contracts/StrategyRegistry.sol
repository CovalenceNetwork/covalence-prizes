// StrategyRegistry.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract StrategyRegistry {
  mapping(string => address) private strategyAddresses;
  address public owner;

  constructor() {
    owner = msg.sender;
  }

  modifier onlyOwner() {
    require(msg.sender == owner, "Only owner can perform this action");
    _;
  }

  function setStrategyAddress(
    string memory strategyName,
    address strategyAddress
  ) public onlyOwner {
    require(strategyAddress != address(0), "Invalid strategy address");
    strategyAddresses[strategyName] = strategyAddress;
  }

  function removeStrategyAddress(string memory strategyName) public onlyOwner {
    require(
      strategyAddresses[strategyName] != address(0),
      "Strategy not found"
    );
    delete strategyAddresses[strategyName];
  }

  function getStrategyAddress(
    string memory strategyName
  ) public view returns (address) {
    address strategyAddress = strategyAddresses[strategyName];
    require(strategyAddress != address(0), "Unknown strategy name");
    return strategyAddress;
  }
}
