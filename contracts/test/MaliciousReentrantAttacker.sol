// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITransferHook} from "../../interfaces/ITransferHook.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IFundControllerAttackerTarget {
    function allotShares(address wallet, uint256 amount, bytes32 subscriptionId) external returns (uint256);
    function distributeToWallet(address wallet, uint256 cycleId, uint256 reportedBalance) external returns (uint256);
    function requestRedeem(address wallet, uint256 amount, bytes32 redeemRequestId) external;
    function fundBrokerReserve(bytes32 broker, uint256 amount) external;
    function sweepReserve(uint256 amount, address to) external;
}

/// @title MaliciousReentrantAttacker
/// @notice Simulates an adversarial contract / hook attempting cross-function reentrancy
contract MaliciousReentrantAttacker is ITransferHook {
    IFundControllerAttackerTarget public targetController;
    IERC20 public token;
    bytes32 public broker;
    
    enum AttackMode { None, ReenterAllot, ReenterDistribute, ReenterRedeem, ReenterSweep }
    AttackMode public attackMode;
    bool public attackAttempted;
    bool public attackSucceeded;
    string public revertReason;

    constructor(address _targetController, address _token, bytes32 _broker) {
        targetController = IFundControllerAttackerTarget(_targetController);
        token = IERC20(_token);
        broker = _broker;
    }

    function setAttackMode(AttackMode _mode) external {
        attackMode = _mode;
        attackAttempted = false;
        attackSucceeded = false;
    }

    function beforeTokenTransfer(
        address /* caller */,
        address /* from */,
        address /* to */,
        uint256 /* amount */
    ) external view override {
        // beforeTokenTransfer is view in ITransferHook - EVM STATICCALL prevents state modification here by default!
    }

    function afterTokenTransfer(
        address /* caller */,
        address /* from */,
        address /* to */,
        uint256 /* amount */
    ) external override {
        _attemptReentrancy();
    }

    function _attemptReentrancy() internal {
        if (attackAttempted) return; // prevent infinite recursion during test harness
        
        if (attackMode == AttackMode.ReenterAllot) {
            attackAttempted = true;
            try targetController.allotShares(address(this), 10 ether, bytes32(uint256(99999))) {
                attackSucceeded = true;
            } catch Error(string memory reason) {
                revertReason = reason;
            } catch {
                revertReason = "RevertedWithCustomErrorOrNoString";
            }
        } else if (attackMode == AttackMode.ReenterDistribute) {
            attackAttempted = true;
            try targetController.distributeToWallet(address(this), 1, 100 ether) {
                attackSucceeded = true;
            } catch Error(string memory reason) {
                revertReason = reason;
            } catch {
                revertReason = "RevertedWithCustomErrorOrNoString";
            }
        } else if (attackMode == AttackMode.ReenterRedeem) {
            attackAttempted = true;
            try targetController.requestRedeem(address(this), 10 ether, bytes32(uint256(88888))) {
                attackSucceeded = true;
            } catch Error(string memory reason) {
                revertReason = reason;
            } catch {
                revertReason = "RevertedWithCustomErrorOrNoString";
            }
        } else if (attackMode == AttackMode.ReenterSweep) {
            attackAttempted = true;
            try targetController.sweepReserve(10 ether, address(this)) {
                attackSucceeded = true;
            } catch Error(string memory reason) {
                revertReason = reason;
            } catch {
                revertReason = "RevertedWithCustomErrorOrNoString";
            }
        }
    }
}
