// SPDX-License-Identifier: GPL-2.0-or-later
// TokenX Contracts v1.0.4 (contracts/legacy/BrokerCorridorGateway.sol)
pragma solidity 0.8.25;

import {IAllowlistRegistry} from "../../interfaces/IAllowlistRegistry.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title BrokerCorridorGateway
 * @notice Deprecated standalone gateway retained for backward compatibility.
 *         Use `AllowlistRegistryProxyV2` for new deployments.
 * @dev Gates wallet-to-wallet transfers by broker membership. Supports
 *      an arbitrary number of brokers (N), not just two -- corridors
 *      are pairwise, so N brokers give up to N*(N-1)/2 independently
 *      controllable corridors (symmetric by default).
 *
 * This contract satisfies {IAllowlistRegistry} for {InvestmentTokenM} compatibility.
 */
contract BrokerCorridorGateway is AccessControl, IAllowlistRegistry {
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    bytes32 public constant CORRIDOR_ADMIN_ROLE = keccak256("CORRIDOR_ADMIN_ROLE");

    /// @notice wallet -> broker id. Zero bytes32 means unregistered.
    mapping(address => bytes32) public walletBroker;

    /// @notice brokerA -> brokerB -> allowed.
    mapping(bytes32 => mapping(bytes32 => bool)) public corridorAllowed;

    /// @notice Global kill-switch: once true, ALL cross-broker transfers are allowed.
    bool public crossBrokerTransfersGloballyEnabled;

    /**
     * @dev Emitted when a wallet is registered to a broker.
     */
    event WalletRegistered(address indexed wallet, bytes32 indexed broker);

    /**
     * @dev Emitted when a broker-to-broker corridor state is updated.
     */
    event CorridorSet(bytes32 indexed brokerA, bytes32 indexed brokerB, bool allowed, bool symmetric);

    /**
     * @dev Emitted when the global unlock switch is changed.
     */
    event GlobalUnlockChanged(bool enabled);

    error WalletNotRegistered(address wallet);
    error CrossBrokerTransferNotAllowed(address from, address to, bytes32 brokerFrom, bytes32 brokerTo);
    error SameBroker(bytes32 broker);
    error ArrayLengthMismatch();

    constructor(address admin_) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
    }

    // ---------------------------------------------------------------
    // Wallet <-> broker registry
    // ---------------------------------------------------------------

    /**
     * @dev Registers a wallet to a broker ID.
     *
     * Requirements:
     * - caller must have {REGISTRAR_ROLE}.
     */
    function registerWallet(address wallet, bytes32 broker) external onlyRole(REGISTRAR_ROLE) {
        walletBroker[wallet] = broker;
        emit WalletRegistered(wallet, broker);
    }

    /**
     * @dev Registers multiple wallets to broker IDs in batch.
     *
     * Requirements:
     * - caller must have {REGISTRAR_ROLE}.
     */
    function registerWalletsBatch(address[] calldata wallets, bytes32[] calldata brokers) external onlyRole(REGISTRAR_ROLE) {
        if (wallets.length != brokers.length) revert ArrayLengthMismatch();
        for (uint256 i = 0; i < wallets.length; i++) {
            walletBroker[wallets[i]] = brokers[i];
            emit WalletRegistered(wallets[i], brokers[i]);
        }
    }

    // ---------------------------------------------------------------
    // Corridor management -- scales to N brokers, not just 2
    // ---------------------------------------------------------------

    /**
     * @dev Sets a symmetric corridor (both A<->B and B<->A at once).
     *
     * Requirements:
     * - caller must have {CORRIDOR_ADMIN_ROLE}.
     */
    function setCorridor(bytes32 brokerA, bytes32 brokerB, bool allowed) external onlyRole(CORRIDOR_ADMIN_ROLE) {
        if (brokerA == brokerB) revert SameBroker(brokerA);
        corridorAllowed[brokerA][brokerB] = allowed;
        corridorAllowed[brokerB][brokerA] = allowed;
        emit CorridorSet(brokerA, brokerB, allowed, true);
    }

    /**
     * @dev Sets a directional corridor (fromBroker -> toBroker only).
     *
     * Requirements:
     * - caller must have {CORRIDOR_ADMIN_ROLE}.
     */
    function setCorridorDirectional(bytes32 brokerFrom, bytes32 brokerTo, bool allowed) external onlyRole(CORRIDOR_ADMIN_ROLE) {
        if (brokerFrom == brokerTo) revert SameBroker(brokerFrom);
        corridorAllowed[brokerFrom][brokerTo] = allowed;
        emit CorridorSet(brokerFrom, brokerTo, allowed, false);
    }

    /**
     * @dev Sets global corridor override kill-switch.
     *
     * Requirements:
     * - caller must have {DEFAULT_ADMIN_ROLE}.
     */
    function setGlobalUnlock(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        crossBrokerTransfersGloballyEnabled = enabled;
        emit GlobalUnlockChanged(enabled);
    }

    // ---------------------------------------------------------------
    // The actual gate -- called from the token's transfer hook
    // ---------------------------------------------------------------

    /**
     * @dev Reverts if the transfer isn't allowed; returns silently if it is.
     *      Same-broker transfers always pass, regardless of corridor state.
     */
    function checkTransfer(address from, address to) external view {
        bytes32 brokerFrom = walletBroker[from];
        bytes32 brokerTo = walletBroker[to];

        if (brokerFrom == bytes32(0)) revert WalletNotRegistered(from);
        if (brokerTo == bytes32(0)) revert WalletNotRegistered(to);

        if (brokerFrom == brokerTo) return; // same broker: always fine, any N

        if (crossBrokerTransfersGloballyEnabled) return;
        if (corridorAllowed[brokerFrom][brokerTo]) return;

        revert CrossBrokerTransferNotAllowed(from, to, brokerFrom, brokerTo);
    }

    /**
     * @dev Boolean check for UI/clients.
     */
    function isTransferAllowed(address from, address to) public view returns (bool) {
        bytes32 brokerFrom = walletBroker[from];
        bytes32 brokerTo = walletBroker[to];
        if (brokerFrom == bytes32(0) || brokerTo == bytes32(0)) return false;
        if (brokerFrom == brokerTo) return true;
        if (crossBrokerTransfersGloballyEnabled) return true;
        return corridorAllowed[brokerFrom][brokerTo];
    }

    /**
     * @dev Boolean check for UI/clients matching TokenX `isAllow...` convention.
     */
    function isAllowTransfer(address from, address to) external view returns (bool) {
        return isTransferAllowed(from, to);
    }

    /**
     * @dev Satisfies {IAllowlistRegistry} interface for audited {InvestmentTokenM} compatibility.
     *      A wallet registered to any non-zero broker ID is automatically considered allowlisted.
     */
    function isAllowlist(address account) external view returns (bool) {
        return walletBroker[account] != bytes32(0);
    }
}