// SPDX-License-Identifier: GPL-2.0-or-later
// TokenX Contracts v1.0.3 (contracts/InvestmentTokenM.sol)
pragma solidity 0.8.25;

// Local Extensions & Compliance Modules
import {ERC20Hooks} from "../extensions/ERC20Hooks.sol";
import {ERC20Mintable} from "../extensions/ERC20Mintable.sol";
import {EmergencyWithdrawable} from "../extensions/EmergencyWithdrawable.sol";
import {ERC20AllowListableProxy} from "../extensions/ERC20AllowListableProxy.sol";
import {ERC20TransferLimitable} from "../extensions/ERC20TransferLimitable.sol";

// OpenZeppelin Contracts
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/**
 * @dev {ERC20} token, including:
 *
 *  - Ability for holders to burn (destroy) their tokens.
 *  - The owner or {AM_ROLE} is allowed to mint tokens.
 *  - The owner or {DEFAULT_ADMIN_ROLE} is allowed to stop all token transfers.
 *  - The owner is allowed to set a transfer limit for a specific address.
 *  - The owner is allowed to add a specific address to the allowlist to transfer and receive tokens.
 *  - External lifecycle hook support (Uniswap v4 style before/after callbacks via {ERC20Hooks}).
 *
 * This contract uses {Ownable} and {AccessControl} to include access control capabilities.
 * This contract uses {Pausable} to include pause capabilities.
 * This contract uses {ERC20Burnable} to include burn capabilities.
 * This contract uses {ERC20Mintable} to include mint control capabilities.
 * This contract uses {ERC20TransferLimitable} to include transfer limit control capabilities.
 * This contract uses {ERC20AllowListableProxy} to include transfer and receive control capabilities.
 * This contract uses {EmergencyWithdrawable} to include emergency withdraw capabilities.
 * This contract uses {ERC20Hooks} to include external lifecycle hook capabilities.
 */
contract InvestmentTokenM is
    // Access & Lifecycle Control
    Ownable,
    AccessControl,
    Pausable,
    // Core Token Standards & Supply Management
    ERC20Burnable,
    ERC20Mintable,
    // Protocol & Compliance Extensions
    ERC20Hooks,
    ERC20TransferLimitable,
    ERC20AllowListableProxy,
    EmergencyWithdrawable
{
    bytes32 public constant AM_ROLE = keccak256("AM_ROLE");

    constructor(string memory name_, string memory symbol_, address allowlistRegistry_) ERC20(name_, symbol_) {
        _setAllowlistRegistry(allowlistRegistry_);
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(AM_ROLE, _msgSender());
    }

    /**
     * @dev Returns the number of decimals used for user representation.
     * Conforms to Thai Financial Regulations for mutual fund share units (8 decimals).
     */
    function decimals() public view virtual override returns (uint8) {
        return 8;
    }

    /**
     * @dev Throws if sender or receiver is not an allowlisted account.
     *      The owner intentionally bypasses allowlist checks for transfers, approvals,
     *      allowance updates, and burns, and must therefore be a trusted administrator.
     */
    modifier onlyAllowlist(address sender, address receiver) {
        address _msgSender = _msgSender();
        if (_msgSender != owner()) {
            bool _isAllowlist = isAllowlist(sender) && isAllowlist(receiver) && isAllowlist(_msgSender);
            require(_isAllowlist, "InvestmentTokenM: account are not allowlisted");
        }
        _;
    }

    /**
     * @dev See {ERC20AllowListableProxy-_setAllowlistRegistry}
     * 
     * Set the `allowlistRegistry` contract address.
     * 
     * Emits an {AllowlistRegistryChanged} event indicating allowlist registry has changed.
     *
     * Requirements:
     *
     * - the caller must be owner.
     * - `allowlistRegistry` must be a non-zero address with deployed contract code.
     */
    function setAllowlistRegistry(address allowlistRegistry) external virtual {
        if (_msgSender() != owner() && !hasRole(DEFAULT_ADMIN_ROLE, _msgSender())) {
            revert("Ownable: caller is not the owner");
        }
        _setAllowlistRegistry(allowlistRegistry);
    }

    /**
     * @dev Sets the external transfer hook contract address.
     *
     * Requirements:
     * - caller must be owner or have {DEFAULT_ADMIN_ROLE}.
     */
    function setTransferHook(address newHook) external virtual override {
        if (_msgSender() != owner() && !hasRole(DEFAULT_ADMIN_ROLE, _msgSender())) {
            revert("Ownable: caller is not the owner");
        }
        address oldHook = transferHook;
        transferHook = newHook;
        emit TransferHookSet(oldHook, newHook);
    }

    /**
     * @dev See {ERC20TransferLimit-_enableTransferLimitable}
     * 
     * Enables transfer limits.
     * 
     * Emits an {EnableERC20TransferLimit} event indicating transfer limits are enabled.
     *
     * Requirements:
     *
     * - the caller must be owner.
     */
    function enableTransferLimitable() external virtual onlyOwner {
        _enableTransferLimitable();
    }

    /**
     * @dev See {ERC20TransferLimit-_disableTransferLimitable}
     *
     * Disables transfer limits.
     * 
     * Emits a {DisableERC20TransferLimit} event indicating transfer limits are disabled.
     * 
     * Requirements:
     * 
     * - the caller must be owner.
     */
    function disableTransferLimitable() external virtual onlyOwner {
        _disableTransferLimitable();
    }

    /**
     * @dev See {ERC20TransferLimit-_setTransferLimit}.
     *
     * Sets an account's transfer limit.
     *
     * Emits a {SetTransferLimit} event indicating that account has set transfer limit.
     *
     * Requirements:
     * 
     * - the caller must be owner.
     */
    function setTransferLimit(address account, uint256 amount) external virtual onlyOwner {
        _setTransferLimit(account, amount);
    }

    /**
     * @dev See {ERC20TransferLimit-_unsetTransferLimit}.
     *
     * Unsets an account's transfer limit.
     *
     * Emits an {UnsetTransferLimit} event indicating that account has unset transfer limit.
     *
     * Requirements:
     * 
     * - the caller must be owner.
     */
    function unsetTransferLimit(address account) external virtual onlyOwner {
        _unsetTransferLimit(account);
    }

    /**
     * @dev See {ERC20TransferLimit-_increaseTransferLimit}.
     *
     * Increases the transfer limit for a specific account.
     *
     * Emits an {IncreaseTransferLimit} event indicating that the account's transfer limit has been increased.
     *
     * Requirements:
     * 
     * - the caller must be owner.
     */
    function increaseTransferLimit(address account, uint256 amount) external virtual onlyOwner {
        _increaseTransferLimit(account, amount);
    }

    /**
     * @dev See {ERC20TransferLimit-_decreaseTransferLimit}.
     *
     * Decreases the transfer limit for a specific account.
     *
     * Emits a {DecreaseTransferLimit} event indicating that the account's transfer limit has been decreased.
     *
     * Requirements:
     * 
     * - the caller must be owner.
     */
    function decreaseTransferLimit(address account, uint256 amount) external virtual onlyOwner {
        _decreaseTransferLimit(account, amount);
    }

    /**
     * @dev Creates `amount` new tokens for `_msgSender()`.
     *
     * Requirements:
     * - caller must be owner or have {AM_ROLE}.
     * - `_mintable` must not be renounced.
     */
    function mint(uint256 amount) external virtual whenMintable {
        if (_msgSender() != owner() && !hasRole(AM_ROLE, _msgSender())) {
            revert("Ownable: caller is not the owner");
        }
        _mint(_msgSender(), amount);
    }

    /**
     * @dev See {ERC20Mintable-_renounceMintable}
     * 
     * Leaves the contract without mint capabilities. It will not be possible to call
     * `mint` functions anymore. Can only be called by the current owner and mintable is not renounced yet.
     *
     * Emits a {RenouncedMintable} event indicating that mintable has been renounced.
     *
     * NOTE: Renouncing mintable will leave the contract without mint capabilities,
     * thereby removing any functionality that is only available when mintable.
     *
     * Requirements:
     *
     * - the caller must be owner.
     * - `_mintable` must not be renounced.
     */
    function renounceMintable() external virtual onlyOwner whenMintable {
        _renounceMintable();
    }

    /**
     * @dev See {IERC20-transfer}.
     *
     * Requirements:
     *
     * - `to` cannot be the zero address.
     * - the caller must have a balance of at least `amount`.
     * - the caller and `to` must be an allowlisted account.
     * - the contract must not be paused.
     * - if transfer limits are enabled on an account, the caller must have a transfer limit at least equal to `amount`.
     */
    function transfer(address to, uint256 amount) public virtual override onlyAllowlist(msg.sender, to) validateTransferLimit(msg.sender, amount) whenNotPaused returns (bool) {
        return super.transfer(to, amount);
    }

    /**
     * @dev See {IERC20-approve}.
     *
     * NOTE: If `amount` is the maximum `uint256`, the allowance is not updated on
     * `transferFrom`. This is semantically equivalent to an infinite approval.
     *
     * Requirements:
     *
     * - `spender` cannot be the zero address.
     * - the caller and `spender` must be an allowlisted account.
     * - the contract must not be paused.
     */
    function approve(address spender, uint256 amount) public virtual override onlyAllowlist(msg.sender, spender) whenNotPaused returns (bool) {
        return super.approve(spender, amount);
    }

    /**
     * @dev See {IERC20-transferFrom}.
     *
     * Emits an {Approval} event indicating the updated allowance. This is not
     * required by the EIP. See the note at the beginning of {ERC20}.
     *
     * NOTE: Does not update the allowance if the current allowance
     * is the maximum `uint256`.
     *
     * Requirements:
     *
     * - `from` and `to` cannot be the zero address.
     * - `from` must have a balance of at least `amount`.
     * - the caller must have allowance for `from`'s tokens of at least `amount`.
     * - the caller and `spender` must be an allowlisted account.
     * - the contract must not be paused.
     * - if transfer limits are enabled on a `from` account, the caller must have a transfer limit at least equal to `amount`.
     */
    function transferFrom(address from, address to, uint256 amount) public virtual override onlyAllowlist(from, to) validateTransferLimit(from, amount) whenNotPaused returns (bool) {
        return super.transferFrom(from, to, amount);
    }

    /**
     * @dev See {IERC20-increaseAllowance}.
     * 
     * Atomically increases the allowance granted to `spender` by the caller.
     *
     * This is an alternative to {approve} that can be used as a mitigation for
     * problems described in {IERC20-approve}.
     *
     * Emits an {Approval} event indicating the updated allowance.
     *
     * Requirements:
     *
     * - `spender` cannot be the zero address.
     * - the caller and `spender` must be an allowlisted account.
     * - the contract must not be paused.
     */
    function increaseAllowance(address spender, uint256 addedValue) public override virtual onlyAllowlist(msg.sender, spender) whenNotPaused returns (bool) {
        return super.increaseAllowance(spender, addedValue);
    }

    /**
     * @dev See {IERC20-decreaseAllowance}.
     * 
     * Atomically decreases the allowance granted to `spender` by the caller.
     *
     * This is an alternative to {approve} that can be used as a mitigation for
     * problems described in {IERC20-approve}.
     *
     * Emits an {Approval} event indicating the updated allowance.
     *
     * Requirements:
     *
     * - `spender` cannot be the zero address.
     * - `spender` must have allowance for the caller of at least
     * `subtractedValue`.
     * - the caller and `spender` must be an allowlisted account.
     * - the contract must not be paused.
     */
    function decreaseAllowance(address spender, uint256 subtractedValue) public override virtual onlyAllowlist(msg.sender, spender) whenNotPaused returns (bool) {
        return super.decreaseAllowance(spender, subtractedValue);
    }

    /**
     * @dev See {ERC20-_burn}.
     * 
     * Destroys `amount` tokens from the caller.
     *
     * Requirements:
     *
     * - the caller must be an allowlisted account.
     * - the contract must not be paused.
     */
    function burn(uint256 amount) public virtual override onlyAllowlist(msg.sender, msg.sender) whenNotPaused {
        super.burn(amount);
    }

    /**
     * @dev See {ERC20-_burn} and {ERC20-allowance}.
     * 
     * Destroys `amount` tokens from `account`, deducting from the caller's
     * allowance.
     *
     * Requirements:
     *
     * - the caller must have allowance for `account`'s tokens of at least
     * `amount`.
     * - the caller and `account` must be an allowlisted account.
     * - the contract must not be paused.
     */
    function burnFrom(address account, uint256 amount) public virtual override onlyAllowlist(msg.sender, account) whenNotPaused {
        super.burnFrom(account, amount);
    }

    /**
     * @dev Force transfer by the owner.
     *
     * Requirements:
     *
     * - `from` cannot be the zero address.
     * - `from` must have a balance of at least `amount`.
     * - `to` cannot be the zero address.
     * - the caller must be owner.
     *
     * NOTE: This privileged operation intentionally bypasses pause, allowlist,
     * and transfer-limit checks. Token transfer hooks still execute.
     */
    function adminTransfer(address from, address to, uint256 amount) external virtual {
        if (_msgSender() != owner() && !hasRole(AM_ROLE, _msgSender()) && !hasRole(DEFAULT_ADMIN_ROLE, _msgSender())) {
            revert("Ownable: caller is not the owner");
        }
        _transfer(from, to, amount);
    }

    /**
     * @dev Force burn by the owner or AM_ROLE.
     *
     * Requirements:
     * - `account` cannot be the zero address.
     * - `account` must have a balance of at least `amount`.
     * - the caller must be owner or have {AM_ROLE}.
     */
    function adminBurn(address account, uint256 amount) external virtual {
        if (_msgSender() != owner() && !hasRole(AM_ROLE, _msgSender()) && !hasRole(DEFAULT_ADMIN_ROLE, _msgSender())) {
            revert("Ownable: caller is not the owner");
        }
        _burn(account, amount);
    }

    /**
     * @dev See {ERC20Pausable} and {Pausable-_pause}.
     * 
     * Pauses all token transfers.
     *
     * Requirements:
     * - the caller must be owner or have {DEFAULT_ADMIN_ROLE}.
     */
    function pause() external {
        if (_msgSender() != owner() && !hasRole(DEFAULT_ADMIN_ROLE, _msgSender())) {
            revert("Ownable: caller is not the owner");
        }
        _pause();
    }

    /**
     * @dev See {ERC20Pausable} and {Pausable-_unpause}.
     * 
     * Unpauses all token transfers.
     *
     * Requirements:
     * - the caller must be owner or have {DEFAULT_ADMIN_ROLE}.
     */
    function unpause() external {
        if (_msgSender() != owner() && !hasRole(DEFAULT_ADMIN_ROLE, _msgSender())) {
            revert("Ownable: caller is not the owner");
        }
        _unpause();
    }

    /**
     * @dev See {EmergencyWithdrawable-_emergencyWithdrawToken}.
     * 
     * Withdraw ERC20 `token` from (this) contract to owner.
     *
     * Requirements:
     *
     * - the caller must be owner.
     */
    function emergencyWithdrawToken(address token) external onlyOwner {
        _emergencyWithdrawToken(owner(), token);
    }

    /**
     * @dev See {ERC20Hooks-_beforeTokenTransfer}.
     *
     * Resolves the inherited ERC20 hook and delegates pre-transfer compliance
     * checks to the configured {ITransferHook} through {ERC20Hooks}.
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override(ERC20, ERC20Hooks) {
        super._beforeTokenTransfer(from, to, amount);
    }

    /**
     * @dev See {ERC20Hooks-_afterTokenTransfer}.
     *
     * Resolves the inherited ERC20 hook and delegates post-transfer processing
     * to the configured {ITransferHook} through {ERC20Hooks}.
     */
    function _afterTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override(ERC20, ERC20Hooks) {
        super._afterTokenTransfer(from, to, amount);
    }
}