// SPDX-License-Identifier: GPL-2.0-or-later
// TokenX Contracts v1.0.1 (contracts/AllowlistRegistryProxy.sol)
pragma solidity 0.8.25;

// Local Extensions
import {Blacklistable} from "../extensions/Blacklistable.sol";

// Local Interfaces
import {IAllowlistRegistry} from "../interfaces/IAllowlistRegistry.sol";

// OpenZeppelin Contracts
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title AllowlistRegistryProxy
 * @dev Contract module that provides capabilities for managing allowlist registries.
 *
 * Only the owner is allowed to manage allowlist registries.
 */
contract AllowlistRegistryProxy is
    // Access Control & Blacklist Gating
    Ownable,
    Blacklistable,
    // Allowlist Registry Interface
    IAllowlistRegistry
{
    using EnumerableSet for EnumerableSet.AddressSet;

    // --- Built-in Storage ---
    EnumerableSet.AddressSet internal _registries;
    string internal _proxyName;

    struct RegistryInfo {
        string provider;
        bool paused;
    }

    mapping(address => RegistryInfo) internal _registryInfo;

    /**
     * @dev Error indicating that the registry already exists in the allowlist registry proxy.
     */
    error ExistRegistry(address registry);

    /**
     * @dev Error indicating that the registry does not exist in the allowlist registry proxy.
     */
    error NotExistRegistry(address registry);

    /**
     * @dev Error indicating that the registry is paused.
     */
    error PausedRegistry(address registry);

    /**
     * @dev Error indicating that the registry is unpaused.
     */
    error UnpausedRegistry(address registry);

    /**
     * @dev Emitted when a new registry is added to the allowlist registry proxy.
     */
    event RegistryAdded(string indexed provider, address indexed registry);

    /**
     * @dev Emitted when a registry is removed from the allowlist registry proxy.
     */
    event RegistryRemoved(address indexed registry);

    /**
     * @dev Emitted when a registry is paused.
     */
    event RegistryPaused(address indexed registry);

    /**
     * @dev Emitted when a registry is unpaused.
     */
    event RegistryUnpaused(address indexed registry);

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
        return "1.0.0";
    }

    /**
     * @dev Returns the name of the allowlist registry proxy.
     */
    function name() external view returns (string memory) {
        return _proxyName;
    }

    // ##############################
    // #          REGISTRY          #
    // ##############################

    /**
     * @dev Returns an array of registered registry addresses.
     * @return registry addresses.
     */
    function registries() external view returns (address[] memory) {
        return _registries.values();
    }

    /**
     * @dev Returns the total length of registries in the allowlist registry proxy.
     * @return total length of registries.
     */
    function totalRegistry() external view returns (uint256) {
        return _registries.length();
    }

    /**
     * @dev Returns registry information of the given registry address.
     * @param registry The address of the registry.
     * @return provider name and paused status of the registry.
     */
    function getRegistryInfo(address registry) external view returns (string memory, bool) {
        RegistryInfo memory registryInfo = _registryInfo[registry];
        return (registryInfo.provider, registryInfo.paused);
    }

    /**
     * @dev Returns registry information of the given account's provider.
     * @param account The address of the account.
     * @return A tuple containing arrays of provider names, provider addresses, and account's allowlist status with each provider.
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

            if (IAllowlistRegistry(registry).isAllowlist(account)) {
                allowlists[i] = true;
            }
        }

        return (providers, addresses, allowlists);
    }

    /**
     * @dev Adds a new registry to the allowlist registry proxy.
     * @param provider The provider name of the registry.
     * @param registry The address of the registry.
     *
     * Requirements:
     * - the caller must be owner.
     * - the registry should not already exist in the allowlist registry proxy.
     */
    function addRegistry(string memory provider, address registry) external onlyOwner notExistRegistry(registry) {
        _registries.add(registry);
        _registryInfo[registry] = RegistryInfo(provider, false);

        emit RegistryAdded(provider, registry);
    }

    /**
     * @dev Removes a registry from the allowlist registry proxy.
     * @param registry The address of the registry.
     *
     * Requirements:
     * - the caller must be owner.
     * - the registry should exist in the allowlist registry proxy.
     */
    function removeRegistry(address registry) external onlyOwner existRegistry(registry) {
        _registries.remove(registry);
        delete _registryInfo[registry];

        emit RegistryRemoved(registry);
    }

    /**
     * @dev Pauses a registry in the allowlist registry proxy.
     * @param registry The address of the registry.
     *
     * Requirements:
     * - the caller must be owner.
     * - the registry should not be paused.
     */
    function pauseRegistry(address registry) external onlyOwner existRegistry(registry) unpausedRegistry(registry) {
        _registryInfo[registry].paused = true;

        emit RegistryPaused(registry);
    }

    /**
     * @dev Unpauses a registry in the allowlist registry proxy.
     * @param registry The address of the registry.
     *
     * Requirements:
     * - caller must be owner.
     * - registry must be paused.
     */
    function unpauseRegistry(address registry) external onlyOwner existRegistry(registry) pausedRegistry(registry) {
        _registryInfo[registry].paused = false;

        emit RegistryUnpaused(registry);
    }

    // ##############################
    // #          BLACKLIST         #
    // ##############################

    /**
     * @dev Adds an account to the blacklist.
     * @param account The address of the account.
     *
     * Requirements:
     * - the caller must be owner.
     */
    function addBlacklist(address account) public override onlyOwner {
        super.addBlacklist(account);
    }

    /**
     * @dev Removes an account from the blacklist.
     * @param account The address of the account.
     *
     * Requirements:
     * - the caller must be owner.
     */
    function removeBlacklist(address account) public override onlyOwner {
        super.removeBlacklist(account);
    }

    /**
     * @dev Returns the blacklist status of an account.
     * @param account The address of the account to check.
     */
    function isBlacklist(address account) public view override returns (bool) {
        return super.isBlacklist(account);
    }

    // ##############################
    // #     ALLOWLIST REGISTRY     #
    // ##############################

    /**
     * @dev Returns the allowlist status of an account.
     * @param account The address of the account.
     */
    function isAllowlist(address account) external view override returns (bool) {
        if (isBlacklist(account)) {
            return false;
        }

        uint256 length = _registries.length();
        for (uint256 i = 0; i < length; i++) {
            address registry = _registries.at(i);

            if (!_registryInfo[registry].paused && IAllowlistRegistry(registry).isAllowlist(account)) {
                return true;
            }
        }

        return false;
    }
}
