// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Standard external lifecycle hook interface for ERC-20 tokens (Uniswap v4 style)
interface ITransferHook {
    function beforeTokenTransfer(
        address caller,
        address from,
        address to,
        uint256 amount
    ) external view;

    function afterTokenTransfer(
        address caller,
        address from,
        address to,
        uint256 amount
    ) external;
}
