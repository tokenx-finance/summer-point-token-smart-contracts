// SPDX-License-Identifier: GPL-2.0-or-later
// TokenX Contracts (extensions/FundReserveModule.sol)
pragma solidity 0.8.25;

// Core Fund Storage
import {FundStorage} from "./FundStorage.sol";

// OpenZeppelin Contracts
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title FundReserveModule
 * @dev Manages isolated per-broker reserve quotas, global sweep/funding, and inter-broker balance transfers.
 */
abstract contract FundReserveModule is FundStorage {
    using SafeERC20 for IERC20;

    /**
     * @dev Funds the controller vault with unallocated reserve tokens.
     */
    function fundReserve(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        unallocatedReserve += amount;
        investmentToken.safeTransferFrom(msg.sender, address(this), amount);
        emit ReserveFunded(msg.sender, amount);
    }

    /**
     * @dev Allocates reserve tokens specifically into an isolated broker quota pool.
     */
    function fundBrokerReserve(bytes32 broker, uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        brokerReserve[broker] += amount;
        investmentToken.safeTransferFrom(msg.sender, address(this), amount);
        emit BrokerReserveFunded(broker, msg.sender, amount);
    }

    /**
     * @dev Rebalances unallocated reserve quota between two brokers.
     *
     * Requirements:
     * - caller must have {DEFAULT_ADMIN_ROLE}.
     */
    function rebalanceBrokerReserve(bytes32 fromBroker, bytes32 toBroker, uint256 amount)
        external
        onlyAMOrAdmin
        nonReentrant
        whenNotPaused
    {
        if (amount == 0) revert ZeroAmount();
        if (fromBroker == toBroker) revert SameBroker(fromBroker);
        if (brokerReserve[fromBroker] < amount) {
            revert InsufficientReserve(amount, brokerReserve[fromBroker]);
        }

        brokerReserve[fromBroker] -= amount;
        brokerReserve[toBroker] += amount;

        emit BrokerReserveRebalanced(fromBroker, toBroker, amount, msg.sender);
    }

    /**
     * @dev Sweeps unused reserve tokens out of the controller to a treasury/cold wallet.
     *
     * Requirements:
     * - caller must have {AM_ROLE} or {DEFAULT_ADMIN_ROLE}.
     */
    function sweepReserve(uint256 amount, address to) external onlyAMOrAdmin nonReentrant whenNotPaused {
        uint256 available = unallocatedReserve;
        if (amount > available) revert InsufficientReserve(amount, available);
        unallocatedReserve = available - amount;
        investmentToken.safeTransfer(to, amount);
        emit ReserveSwept(to, amount);
    }

    /**
     * @dev Sweeps unused broker reserve back out.
     *
     * Requirements:
     * - caller must have {AM_ROLE} or {DEFAULT_ADMIN_ROLE}.
     */
    function sweepBrokerReserve(bytes32 broker, uint256 amount, address to) external onlyAMOrAdmin nonReentrant whenNotPaused {
        uint256 available = brokerReserve[broker];
        if (amount > available) revert InsufficientReserve(amount, available);
        brokerReserve[broker] -= amount;
        investmentToken.safeTransfer(to, amount);
        emit BrokerReserveSwept(broker, to, amount);
    }

    /**
     * @dev Synchronizes active broker share ledgers when a cross-broker P2P transfer occurs.
     *
     * Requirements:
     * - caller must be the authorized {complianceHook}.
     */
    function syncBrokerShares(bytes32 fromBroker, bytes32 toBroker, uint256 amount) external {
        if (msg.sender != complianceHook) revert OnlyComplianceHook();
        if (fromBroker == toBroker || amount == 0) return;

        uint256 available = totalSharesByBroker[fromBroker];
        if (available < amount) {
            revert InsufficientBrokerShares(fromBroker, amount, available);
        }

        totalSharesByBroker[fromBroker] = available - amount;
        totalSharesByBroker[toBroker] += amount;

        emit BrokerSharesSynced(fromBroker, toBroker, amount);
    }
}
