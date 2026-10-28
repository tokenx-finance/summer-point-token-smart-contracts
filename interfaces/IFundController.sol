// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IFundController {
    function syncBrokerShares(bytes32 fromBroker, bytes32 toBroker, uint256 amount) external;
}
