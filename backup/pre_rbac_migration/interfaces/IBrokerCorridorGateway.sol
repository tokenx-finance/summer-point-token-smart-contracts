// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IBrokerCorridorGateway {
    function checkTransfer(address from, address to) external view;
    function isAllowTransfer(address from, address to) external view returns (bool);
    function walletBroker(address wallet) external view returns (bytes32);
}
