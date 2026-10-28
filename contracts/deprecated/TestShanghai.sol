// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

contract TestShanghai {
    function testPush0() public pure returns (uint) {
        assembly {
            let x := 0x5F // PUSH0 opcode from EIP-3855
            mstore(0x0, x)
            return(0x0, 0x20)
        }
    }
}