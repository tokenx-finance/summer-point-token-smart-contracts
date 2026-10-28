// SPDX-License-Identifier: GPL-2.0-or-later
// TokenX Contracts v1.0.4 (extensions/ERC20Hooks.sol)
pragma solidity 0.8.25;

import {ITransferHook} from "../interfaces/ITransferHook.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @dev Extension of {ERC20} that allows configuring external lifecycle hooks
 * (Uniswap v4 style callbacks) for pre-transfer compliance and post-transfer actions.
 *
 * This module is used through inheritance.
 */
abstract contract ERC20Hooks is ERC20, Ownable {
    address public transferHook;

    /**
     * @dev Emitted when the transfer hook contract address is updated.
     */
    event TransferHookSet(address indexed previousHook, address indexed newHook);

    /**
     * @dev Sets the external transfer hook contract address.
     *
     * Requirements:
     * - caller must be the owner.
     */
    function setTransferHook(address newHook) external virtual onlyOwner {
        address oldHook = transferHook;
        transferHook = newHook;
        emit TransferHookSet(oldHook, newHook);
    }

    /**
     * @dev Hook that is called before any transfer of tokens.
     * Invokes external transfer hook's `beforeTokenTransfer` if configured.
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override {
        super._beforeTokenTransfer(from, to, amount);
        if (transferHook != address(0)) {
            ITransferHook(transferHook).beforeTokenTransfer(_msgSender(), from, to, amount);
        }
    }

    /**
     * @dev Hook that is called after any transfer of tokens.
     * Invokes external transfer hook's `afterTokenTransfer` if configured.
     */
    function _afterTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override {
        super._afterTokenTransfer(from, to, amount);
        if (transferHook != address(0)) {
            ITransferHook(transferHook).afterTokenTransfer(_msgSender(), from, to, amount);
        }
    }
}
