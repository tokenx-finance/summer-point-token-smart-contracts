// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IAllowlistRegistry {
    function isAllowlist(address account) external view returns (bool);
}
