// SPDX-License-Identifier: GPL-2.0-or-later
// TokenX Contracts v2.0.0 (contracts/AllowlistRegistryProxyV2.sol)
pragma solidity 0.8.25;

// Local Extensions
import {Blacklistable} from "../extensions/Blacklistable.sol";

// Local Interfaces
import {IAllowlistRegistry} from "../interfaces/IAllowlistRegistry.sol";
import {IWalletBrokerRegistry} from "../interfaces/IWalletBrokerRegistry.sol";
import {IBrokerCorridorGateway} from "../interfaces/IBrokerCorridorGateway.sol";

// OpenZeppelin Contracts
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title AllowlistRegistryProxyV2
 * @dev Canonical Multi-Broker Allowlist Registry & Transfer Corridor Gateway (v2.0.0).
 *      This is the authoritative registry for new deployments. It maintains
 *      the TokenX v1 {IAllowlistRegistry} API and child-registry fallback while
 *      adding pairwise cross-broker corridor gating, O(1) direct lookups,
 *      and the wallet-to-broker lookup used by the fund controller.
 *
 * This contract satisfies {IAllowlistRegistry}, {IWalletBrokerRegistry}, and {IBrokerCorridorGateway}.
 */
contract AllowlistRegistryProxyV2 is
    // Access Control & Blacklistable Gating
    Ownable,
    Blacklistable,
    // Registry & Corridor Interfaces
    IAllowlistRegistry,
    IWalletBrokerRegistry,
    IBrokerCorridorGateway
{
    using EnumerableSet for EnumerableSet.AddressSet;

    // --- V1 Storage & State ---
    EnumerableSet.AddressSet internal _registries;
    string internal _proxyName;

    struct RegistryInfo {
        string provider;
        bool paused;
    }
    
    mapping(address => RegistryInfo) internal _registryInfo;

    // --- V2 Wallet Registry Storage ---
    mapping(address => bytes32) internal _walletBroker;

    // --- V2 Corridor Storage ---
    mapping(bytes32 => mapping(bytes32 => bool)) internal _corridorAllowed;
    bool internal _crossBrokerTransfersGloballyEnabled;

    // --- V1 Custom Errors ---
    error ExistRegistry(address registry);
    error NotExistRegistry(address registry);
    error PausedRegistry(address registry);
    error UnpausedRegistry(address registry);

    // --- V2 Wallet Registry Custom Errors ---
    error WalletNotRegistered(address wallet);
    error InvalidWallet(address wallet);
    error InvalidBroker(bytes32 broker);
    error ArrayLengthMismatch();

    // --- V2 Registry Aggregation Custom Errors ---
    error InvalidRegistry(address registry);
    error InvalidProvider();

    // --- V2 Corridor Custom Errors ---
    error CrossBrokerTransferNotAllowed(address from, address to, bytes32 brokerFrom, bytes32 brokerTo);
    error SameBroker(bytes32 broker);

    // --- V1 Events ---
    event RegistryAdded(string indexed provider, address indexed registry);
    event RegistryRemoved(address indexed registry);
    event RegistryPaused(address indexed registry);
    event RegistryUnpaused(address indexed registry);

    // --- V2 Wallet Registry Events ---
    event WalletRegistered(address indexed wallet, bytes32 indexed broker);
    event WalletUnregistered(address indexed wallet, bytes32 indexed broker);

    // --- V2 Corridor Events ---
    event CorridorSet(bytes32 indexed brokerA, bytes32 indexed brokerB, bool allowed, bool symmetric);
    event GlobalUnlockChanged(bool enabled);

    modifier existRegistry(address registry) {
        if (!_registries.contains(registry)) {
            revert NotExistRegistry(registry);
        }
        _;
    }

    modifier notExistRegistry(address registry) {
        if (_registries.contains(registry)) {
            revert ExistRegistry(registry);
        }
        _;
    }

    modifier pausedRegistry(address registry) {
        if (!_registryInfo[registry].paused) {
            revert UnpausedRegistry(registry);
        }
        _;
    }

    modifier unpausedRegistry(address registry) {
        if (_registryInfo[registry].paused) {
            revert PausedRegistry(registry);
        }
        _;
    }

    constructor(string memory proxyName_) {
        _proxyName = proxyName_;
    }

    /**
     * @dev Returns the version of the allowlist registry proxy.
     */
    function version() external pure returns (string memory) {
        return "2.0.0";
    }

    /**
     * @dev Returns the name of the allowlist registry proxy.
     */
    function name() external view returns (string memory) {
        return _proxyName;
    }

    // ===============================================================
    // V2: Wallet-to-Broker Registry
    // ===============================================================

    /**
     * @dev Returns the broker ID for a wallet.
     *      Checks direct mapping first (O(1)), then scans attached child registries.
     */
    function walletBroker(address wallet) public view override(IWalletBrokerRegistry, IBrokerCorridorGateway) returns (bytes32) {
        bytes32 direct = _walletBroker[wallet];
        if (direct != bytes32(0)) return direct;

        uint256 length = _registries.length();
        for (uint256 i = 0; i < length; i++) {
            address registry = _registries.at(i);
            if (!_registryInfo[registry].paused) {
                try IAllowlistRegistry(registry).isAllowlist(wallet) returns (bool allowed) {
                    if (allowed) return keccak256(bytes(_registryInfo[registry].provider));
                } catch {
                    continue;
                }
            }
        }
        return bytes32(0);
    }

    /**
     * @dev Registers a wallet to a broker ID.
     *
     * Requirements:
     * - caller must be owner.
     */
    function registerWallet(address wallet, bytes32 broker) external onlyOwner {
        if (wallet == address(0)) revert InvalidWallet(wallet);
        if (broker == bytes32(0)) revert InvalidBroker(broker);
        _walletBroker[wallet] = broker;
        emit WalletRegistered(wallet, broker);
    }

    /**
     * @dev Removes a wallet's direct broker assignment.
     */
    function unregisterWallet(address wallet) external onlyOwner {
        bytes32 broker = _walletBroker[wallet];
        if (broker == bytes32(0)) revert WalletNotRegistered(wallet);
        delete _walletBroker[wallet];
        emit WalletUnregistered(wallet, broker);
    }

    /**
     * @dev Registers multiple wallets to broker IDs in batch.
     *
     * Requirements:
     * - caller must be owner.
     */
    function registerWalletsBatch(address[] calldata wallets, bytes32[] calldata brokers) external onlyOwner {
        if (wallets.length != brokers.length) revert ArrayLengthMismatch();
        for (uint256 i = 0; i < wallets.length; i++) {
            if (wallets[i] == address(0)) revert InvalidWallet(wallets[i]);
            if (brokers[i] == bytes32(0)) revert InvalidBroker(brokers[i]);
            _walletBroker[wallets[i]] = brokers[i];
            emit WalletRegistered(wallets[i], brokers[i]);
        }
    }

    // ===============================================================
    // V2: IBrokerCorridorGateway Implementation
    // ===============================================================

    /**
     * @dev Returns whether corridor from brokerA to brokerB is open.
     */
    function corridorAllowed(bytes32 brokerA, bytes32 brokerB) external view returns (bool) {
        return _corridorAllowed[brokerA][brokerB];
    }

    /**
     * @dev Returns status of global corridor override switch.
     */
    function crossBrokerTransfersGloballyEnabled() external view returns (bool) {
        return _crossBrokerTransfersGloballyEnabled;
    }

    /**
     * @dev Sets a symmetric corridor (both A<->B and B<->A at once).
     *
     * Requirements:
     * - caller must be owner.
     */
    function setCorridor(bytes32 brokerA, bytes32 brokerB, bool allowed) external onlyOwner {
        if (brokerA == bytes32(0)) revert InvalidBroker(brokerA);
        if (brokerB == bytes32(0)) revert InvalidBroker(brokerB);
        if (brokerA == brokerB) revert SameBroker(brokerA);
        _corridorAllowed[brokerA][brokerB] = allowed;
        _corridorAllowed[brokerB][brokerA] = allowed;
        emit CorridorSet(brokerA, brokerB, allowed, true);
    }

    /**
     * @dev Sets a directional corridor (fromBroker -> toBroker only).
     *
     * Requirements:
     * - caller must be owner.
     */
    function setCorridorDirectional(bytes32 brokerFrom, bytes32 brokerTo, bool allowed) external onlyOwner {
        if (brokerFrom == bytes32(0)) revert InvalidBroker(brokerFrom);
        if (brokerTo == bytes32(0)) revert InvalidBroker(brokerTo);
        if (brokerFrom == brokerTo) revert SameBroker(brokerFrom);
        _corridorAllowed[brokerFrom][brokerTo] = allowed;
        emit CorridorSet(brokerFrom, brokerTo, allowed, false);
    }

    /**
     * @dev Sets global corridor override kill-switch.
     *
     * Requirements:
     * - caller must be owner.
     */
    function setGlobalUnlock(bool enabled) external onlyOwner {
        _crossBrokerTransfersGloballyEnabled = enabled;
        emit GlobalUnlockChanged(enabled);
    }

    /**
     * @dev Reverts if the transfer isn't allowed; returns silently if it is.
     *      Same-broker transfers always pass, regardless of corridor state.
     */
    function checkTransfer(address from, address to) external view override {
        if (isBlacklist(from) || isBlacklist(to)) {
            revert CrossBrokerTransferNotAllowed(from, to, bytes32(0), bytes32(0));
        }

        bytes32 brokerFrom = walletBroker(from);
        bytes32 brokerTo = walletBroker(to);

        if (brokerFrom == bytes32(0)) revert WalletNotRegistered(from);
        if (brokerTo == bytes32(0)) revert WalletNotRegistered(to);

        if (brokerFrom == brokerTo) return; // same broker: always fine

        if (_crossBrokerTransfersGloballyEnabled) return;
        if (_corridorAllowed[brokerFrom][brokerTo]) return;

        revert CrossBrokerTransferNotAllowed(from, to, brokerFrom, brokerTo);
    }

    /**
     * @dev Boolean check for UI/clients.
     */
    function isTransferAllowed(address from, address to) public view returns (bool) {
        if (isBlacklist(from) || isBlacklist(to)) return false;

        bytes32 brokerFrom = walletBroker(from);
        bytes32 brokerTo = walletBroker(to);

        if (brokerFrom == bytes32(0) || brokerTo == bytes32(0)) return false;
        if (brokerFrom == brokerTo) return true;
        if (_crossBrokerTransfersGloballyEnabled) return true;
        return _corridorAllowed[brokerFrom][brokerTo];
    }

    /**
     * @dev Boolean check for UI/clients matching TokenX `isAllow...` convention.
     */
    function isAllowTransfer(address from, address to) external view override returns (bool) {
        return isTransferAllowed(from, to);
    }

    // ===============================================================
    // V1: Allowlist Registry & Multi-Registry Aggregation
    // ===============================================================

    /**
     * @dev Returns the allowlist status of an account.
     *      Checks blacklist first, then V2 fast-path (walletBroker != 0),
     *      then V1 fallback (iterates child registries).
     */
    function isAllowlist(address account) public view virtual override returns (bool) {
        if (isBlacklist(account)) {
            return false;
        }

        return walletBroker(account) != bytes32(0);
    }

    /**
     * @dev Returns an array of registered registry addresses.
     */
    function registries() external view returns (address[] memory) {
        return _registries.values();
    }

    /**
     * @dev Returns the total length of registries in the allowlist registry proxy.
     */
    function totalRegistry() external view returns (uint256) {
        return _registries.length();
    }

    /**
     * @dev Returns registry information of the given registry address.
     */
    function getRegistryInfo(address registry) external view returns (string memory, bool) {
        RegistryInfo memory registryInfo = _registryInfo[registry];
        return (registryInfo.provider, registryInfo.paused);
    }

    /**
     * @dev Returns registry information of the given account's provider.
     */
    function getAccountProviderInfo(address account) external view returns (string[] memory, address[] memory, bool[] memory) {
        uint256 length = _registries.length();
        string[] memory providers = new string[](length);
        address[] memory addresses = new address[](length);
        bool[] memory allowlists = new bool[](length);

        for (uint256 i = 0; i < length; i++) {
            address registry = _registries.at(i);
            RegistryInfo memory registryInfo = _registryInfo[registry];
            providers[i] = registryInfo.provider;
            addresses[i] = registry;

            if (!registryInfo.paused) {
                try IAllowlistRegistry(registry).isAllowlist(account) returns (bool allowed) {
                    allowlists[i] = allowed;
                } catch {
                    continue;
                }
            }
        }

        return (providers, addresses, allowlists);
    }

    /**
     * @dev Adds a new registry to the allowlist registry proxy.
     *
     * Requirements:
     * - caller must be owner.
     * - registry must not already exist.
     */
    function addRegistry(string memory provider, address registry) external onlyOwner notExistRegistry(registry) {
        if (bytes(provider).length == 0) revert InvalidProvider();
        if (registry == address(0) || registry.code.length == 0) revert InvalidRegistry(registry);
        _registries.add(registry);
        _registryInfo[registry] = RegistryInfo(provider, false);

        emit RegistryAdded(provider, registry);
    }

    /**
     * @dev Removes a registry from the allowlist registry proxy.
     *
     * Requirements:
     * - caller must be owner.
     * - registry must exist.
     */
    function removeRegistry(address registry) external onlyOwner existRegistry(registry) {
        _registries.remove(registry);
        delete _registryInfo[registry];

        emit RegistryRemoved(registry);
    }

    /**
     * @dev Pauses a registry in the allowlist registry proxy.
     *
     * Requirements:
     * - caller must be owner.
     * - registry must not be paused.
     */
    function pauseRegistry(address registry) external onlyOwner existRegistry(registry) unpausedRegistry(registry) {
        _registryInfo[registry].paused = true;

        emit RegistryPaused(registry);
    }

    /**
     * @dev Unpauses a registry in the allowlist registry proxy.
     *
     * Requirements:
     * - caller must be owner.
     * - registry must be paused.
     */
    function unpauseRegistry(address registry) external onlyOwner existRegistry(registry) pausedRegistry(registry) {
        _registryInfo[registry].paused = false;

        emit RegistryUnpaused(registry);
    }

    // ===============================================================
    // Blacklist
    // ===============================================================

    /// @inheritdoc Blacklistable
    /// @dev Restricted to the contract owner.
    function addBlacklist(address account) public override onlyOwner {
        super.addBlacklist(account);
    }

    /// @inheritdoc Blacklistable
    /// @dev Restricted to the contract owner.
    function removeBlacklist(address account) public override onlyOwner {
        super.removeBlacklist(account);
    }
}
