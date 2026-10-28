// SPDX-License-Identifier: GPL-2.0-or-later
// TokenX Contracts (extensions/FundSubscriptionModule.sol)
pragma solidity 0.8.25;

// Core Fund Storage
import {FundStorage} from "./FundStorage.sol";

// OpenZeppelin Contracts
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {DoubleEndedQueue} from "@openzeppelin/contracts/utils/structs/DoubleEndedQueue.sol";

/**
 * @title FundSubscriptionModule
 * @dev Manages 3-state subscription orders (PENDING, CANCELLED, SUCCESS), strict FIFO queue,
 *      and dual processing modes: batchSize (Queue-based) and refIds[] (Explicit array).
 */
abstract contract FundSubscriptionModule is FundStorage {
    using SafeERC20 for IERC20;
    using DoubleEndedQueue for DoubleEndedQueue.Bytes32Deque;

    // ---------------------------------------------------------------
    // Order Placement (Day T)
    // ---------------------------------------------------------------

    /**
     * @dev Investor/Broker submits a subscription order on Day T (Strict FIFO).
     *
     * Requirements:
     * - caller must have {ALLOTMENT_ROLE}.
     */
    function requestSubscribe(address wallet, uint256 amount, bytes32 refId)
        external
        onlySellingAgentOrAllotment
        nonReentrant
        whenNotPaused
    {
        if (amount == 0) revert ZeroAmount();
        if (_isRefIdUsed(refId)) revert RefIdAlreadyUsed(refId);

        bytes32 broker = _brokerOf(wallet);

        subscriptionOrders[refId] = SubscriptionOrder({
            refId: refId,
            wallet: wallet,
            broker: broker,
            amount: amount,
            requestTimestamp: block.timestamp,
            processedTimestamp: 0,
            status: SubscriptionStatus.PENDING
        });

        _pendingSubscriptionQueue.pushBack(refId);
        _investorSubscriptions[wallet].push(refId);

        pendingSubscriptionVolume[broker] += amount;
        pendingSubscriptionCount[broker] += 1;

        emit SubscriptionRequested(refId, wallet, broker, amount, block.timestamp);
    }

    // ---------------------------------------------------------------
    // Cancellation (Single & Batch)
    // ---------------------------------------------------------------

    /**
     * @dev Cancels a pending subscription order before allotment (O(1) Soft Cancel).
     *
     * Requirements:
     * - caller must have {ALLOTMENT_ROLE}.
     */
    function cancelSubscribe(bytes32 refId)
        external
        onlySellingAgentOrAllotment
        nonReentrant
        whenNotPaused
    {
        _cancelOrder(refId);
    }

    /**
     * @dev Cancels an explicit batch array of pending subscription orders.
     *
     * Requirements:
     * - caller must have {ALLOTMENT_ROLE}.
     */
    function cancelSubscribeBatch(bytes32[] calldata refIds)
        external
        onlySellingAgentOrAllotment
        nonReentrant
        whenNotPaused
    {
        for (uint256 i = 0; i < refIds.length; i++) {
            _cancelOrder(refIds[i]);
        }
    }

    function _cancelOrder(bytes32 refId) internal {
        SubscriptionOrder storage order = subscriptionOrders[refId];
        if (order.status != SubscriptionStatus.PENDING) revert OrderNotPending(refId, order.status);

        order.status = SubscriptionStatus.CANCELLED;
        order.processedTimestamp = block.timestamp;

        pendingSubscriptionVolume[order.broker] -= order.amount;
        pendingSubscriptionCount[order.broker] -= 1;
        cancelledSubscriptionVolume[order.broker] += order.amount;
        cancelledSubscriptionCount[order.broker] += 1;

        emit SubscriptionCancelled(refId, order.wallet, order.broker, order.amount, block.timestamp);
    }

    // ---------------------------------------------------------------
    // Order Processing (Mode A: Queue batchSize | Mode B: Explicit refIds[])
    // ---------------------------------------------------------------

    /**
     * @dev Mode A: Drains pending subscription queue in chunked batches in strict FIFO order.
     *
     * Requirements:
     * - caller must have {ALLOTMENT_ROLE}.
     */
    function processSubscriptions(uint256 batchSize)
        external
        onlySellingAgentOrAllotment
        nonReentrant
        whenNotPaused
        returns (uint256 processedCount, uint256 remainingCount)
    {
        uint256 count = 0;

        while (!_pendingSubscriptionQueue.empty() && count < batchSize) {
            bytes32 refId = _pendingSubscriptionQueue.popFront();
            SubscriptionOrder storage order = subscriptionOrders[refId];

            if (order.status == SubscriptionStatus.CANCELLED) {
                count++;
                continue;
            }

            if (order.status == SubscriptionStatus.PENDING) {
                _fulfillOrder(order, refId);
                count++;
            }
        }

        return (count, _pendingSubscriptionQueue.length());
    }

    /**
     * @dev Mode B: Fulfills an explicit list of subscription reference IDs.
     *
     * Requirements:
     * - caller must have {ALLOTMENT_ROLE}.
     */
    function processSubscriptionsExplicit(bytes32[] calldata refIds)
        external
        onlySellingAgentOrAllotment
        nonReentrant
        whenNotPaused
        returns (uint256 successCount)
    {
        for (uint256 i = 0; i < refIds.length; i++) {
            bytes32 refId = refIds[i];
            SubscriptionOrder storage order = subscriptionOrders[refId];

            if (order.status == SubscriptionStatus.PENDING) {
                _fulfillOrder(order, refId);
                successCount++;
            }
        }
    }

    function _fulfillOrder(SubscriptionOrder storage order, bytes32 refId) internal {
        order.status = SubscriptionStatus.SUCCESS;
        order.processedTimestamp = block.timestamp;

        pendingSubscriptionVolume[order.broker] -= order.amount;
        pendingSubscriptionCount[order.broker] -= 1;
        successSubscriptionVolume[order.broker] += order.amount;
        successSubscriptionCount[order.broker] += 1;

        _allot(order.wallet, order.amount, refId);
        emit SubscriptionSuccess(refId, order.wallet, order.broker, order.amount, block.timestamp);
    }

    // ---------------------------------------------------------------
    // Direct Allotment
    // ---------------------------------------------------------------

    /**
     * @dev Allots newly-subscribed shares directly to an investor wallet.
     *
     * Requirements:
     * - caller must have {ALLOTMENT_ROLE}.
     */
    function allotShares(address wallet, uint256 amount, bytes32 refId)
        external
        onlySellingAgentOrAllotment
        nonReentrant
        whenNotPaused
        returns (uint256)
    {
        return _allotDirect(wallet, amount, refId);
    }

    /**
     * @dev Batch version for direct allotment to multiple wallets in one transaction.
     *
     * Requirements:
     * - caller must have {ALLOTMENT_ROLE}.
     */
    function allotSharesBatch(
        address[] calldata wallets,
        uint256[] calldata amounts,
        bytes32[] calldata refIds
    ) external onlySellingAgentOrAllotment nonReentrant whenNotPaused returns (uint256 totalAllotted) {
        if (wallets.length != amounts.length || wallets.length != refIds.length) {
            revert ArrayLengthMismatch();
        }
        for (uint256 i = 0; i < wallets.length; i++) {
            totalAllotted += _allotDirect(wallets[i], amounts[i], refIds[i]);
        }
    }

    function _allotDirect(address wallet, uint256 amount, bytes32 refId) internal returns (uint256) {
        if (_isRefIdUsed(refId)) revert RefIdAlreadyUsed(refId);
        return _allot(wallet, amount, refId);
    }

    function _allot(address wallet, uint256 amount, bytes32 refId) internal returns (uint256) {
        if (amount == 0) revert ZeroAmount();
        if (allotmentProcessed[refId]) revert AlreadyAllotted(refId);
        if (redemptionRequests[refId].status != RedemptionStatus.NONE) revert RefIdAlreadyUsed(refId);
        allotmentProcessed[refId] = true;

        bytes32 broker = _brokerOf(wallet);

        uint256 available = brokerReserve[broker];
        if (amount > available) revert InsufficientReserve(amount, available);
        brokerReserve[broker] = available - amount;

        totalShares += amount;
        totalSharesByBroker[broker] += amount;
        investmentToken.safeTransfer(wallet, amount);

        emit SharesAllotted(wallet, refId, amount);
        return amount;
    }

    // ---------------------------------------------------------------
    // View Queries
    // ---------------------------------------------------------------

    /**
     * @dev Returns total pending orders in the FIFO queue.
     */
    function pendingSubscriptionQueueLength() external view returns (uint256) {
        return _pendingSubscriptionQueue.length();
    }

    /**
     * @dev Returns list of all historical subscription reference IDs for an investor wallet.
     */
    function getInvestorSubscriptions(address wallet) external view returns (bytes32[] memory) {
        return _investorSubscriptions[wallet];
    }
}
