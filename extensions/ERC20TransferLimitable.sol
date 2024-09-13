// SPDX-License-Identifier: GPL-2.0-or-later
// TokenX Contracts v1.0.1 (extensions/ERC20TransferLimitable.sol)
pragma solidity 0.8.25;

/**
 * @dev Contract module that allows child contracts to implement a transfer limit control
 * mechanism for individual accounts. This mechanism can be managed by an authorized account.
 *
 * This module is designed for use through inheritance.
 */
abstract contract ERC20TransferLimitable {
    struct TransferLimit {
        bool limitable;
        uint256 amount;
    }

    bool private _transferLimitable = true;

    mapping(address => TransferLimit) private _transferLimitList;

    /**
     * @dev Emitted when transfer limits are enabled for the contract.
     */
    event EnableTransferLimitable();

    /**
     * @dev Emitted when transfer limits are disabled for the contract.
     */
    event DisableTransferLimitable();

    /**
     * @dev Emitted when a transfer limit is set for a specific account.
     */
    event SetTransferLimit(address indexed account, uint256 amount);

    /**
     * @dev Emitted when the transfer limit is removed from a specific account.
     */
    event UnsetTransferLimit(address indexed account);

    /**
     * @dev Emitted when the transfer limit for a specific account is increased.
     */
    event IncreaseTransferLimit(address indexed account, uint256 amount);

    /**
     * @dev Emitted when the transfer limit for a specific account is decreased.
     */
    event DecreaseTransferLimit(address indexed account, uint256 amount);

    /**
     * @dev Modifier that a transfer amount against the account's transfer limit. If the limit is exceeded, the transaction reverts.
     *
     * NOTE: Updates the remaining transfer limit for the account if the transfer is valid.
     *
     * @param account The address of the account attempting the transfer.
     * @param amount The amount being transferred.
     */
    modifier validateTransferLimit(address account, uint256 amount) {
        if (_transferLimitable && _transferLimitList[account].limitable) {
            require(amount <= _transferLimitList[account].amount, "ERC20TransferLimit: transfer exceeds limit");
            _transferLimitList[account].amount -= amount;
        }
        _;
    }

    /**
     * @dev Throws if called when transfer limitable are disabled.
     */
    modifier whenTransferLimitableEnabled() {
        require(_transferLimitable, "ERC20TransferLimit: transfer limit disabled");
        _;
    }

    /**
     * @dev Throws if called when transfer limitable are enabled.
     */
    modifier whenTransferLimitableDisabled() {
        require(!_transferLimitable, "ERC20TransferLimit: transfer limit enabled");
        _;
    }

    /**
     * @dev Throws if the specified account's transfer limits are disabled. 
     */
    modifier requireTransferLimitEnabled(address account) {
        require(_transferLimitList[account].limitable, "ERC20TransferLimit: account transfer limit disabled");
        _;
    }

    /**
     * @dev Throws if the specified account's transfer limits are enabled. 
     */
    modifier requireTransferLimitDisabled(address account) {
        require(!_transferLimitList[account].limitable, "ERC20TransferLimit: account transfer limit enabled");
        _;
    }

    /**
     * @dev Returns the transfer limitable state.
     */
    function transferLimitable() external view returns (bool) {
        return _transferLimitable;
    }

    /**
     * @dev Returns the transfer limit status and amount for a given account.
     * @param account The address of the account to query.
     * @return bool True if the account has a transfer limit, false otherwise.
     * @return uint256 The current transfer limit amount for the account.
     */
    function transferLimitOf(address account) external view returns (bool, uint256) {
        TransferLimit memory _account = _transferLimitList[account];
        return (_account.limitable, _account.amount);
    }

    /**
     * @dev Enables transfer limits for the contract.
     * 
     * Requirements:
     *
     * - `_transferLimitable` must be disabled.
     */
    function _enableTransferLimitable() internal virtual whenTransferLimitableDisabled  {
        _transferLimitable = true;

        emit EnableTransferLimitable();
    }

    /**
     * @dev Disables transfer limits for the contract.
     * 
     * Requirements:
     *
     * - `_transferLimitable` must be enabled.
     */
    function _disableTransferLimitable() internal virtual whenTransferLimitableEnabled {
        _transferLimitable = false;

        emit DisableTransferLimitable();
    }

    /**
     * @dev Sets a transfer limit for a specific account.
     * @param account The address of the account to set the limit for.
     * @param amount The new transfer limit amount.
     * 
     * Requirements:
     *
     * - the account transfer limit must be disabled.
     */
    function _setTransferLimit(address account, uint256 amount) internal virtual requireTransferLimitDisabled(account) {
        _transferLimitList[account].limitable = true;
        _transferLimitList[account].amount = amount;

        emit SetTransferLimit(account, amount);
    }

    /**
     * @dev Removes the transfer limit for a specific account.
     * @param account The address of the account to remove the limit for.
     * 
     * Requirements:
     *
     * - the account transfer limit must be enabled.
     */
    function _unsetTransferLimit(address account) internal virtual requireTransferLimitEnabled(account) {
        _transferLimitList[account].limitable = false;
        _transferLimitList[account].amount = 0;

        emit UnsetTransferLimit(account);
    }

    /**
     * @dev Increases the transfer limit for a specific account.
     * @param account The address of the account whose limit will be increased.
     * @param amount The amount by which to increase the transfer limit.
     */
    function _increaseTransferLimit(address account, uint256 amount) internal virtual requireTransferLimitEnabled(account) {
        _transferLimitList[account].amount += amount;

        emit IncreaseTransferLimit(account, amount);
    }

    /**
     * @dev Decreases the transfer limit for a specific account.
     * @param account The address of the account whose limit will be decreased.
     * @param amount The amount by which to decrease the transfer limit.
     */
    function _decreaseTransferLimit(address account, uint256 amount) internal virtual requireTransferLimitEnabled(account) {
        if (_transferLimitList[account].amount < amount) {
            _transferLimitList[account].amount = 0;
        } else {
            _transferLimitList[account].amount -= amount;
        }

        emit DecreaseTransferLimit(account, amount);
    }
}