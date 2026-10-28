// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal read interface matching BrokerCorridorGateway's
///         walletBroker() getter, so both contracts share one source of
///         truth for wallet -> broker assignment.
interface IWalletBrokerRegistry {
    function walletBroker(address wallet) external view returns (bytes32);
}
