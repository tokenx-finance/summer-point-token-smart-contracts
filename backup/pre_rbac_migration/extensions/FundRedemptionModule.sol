// SPDX-License-Identifier: GPL-2.0-or-later
// TokenX Contracts (extensions/FundRedemptionModule.sol)
pragma solidity 0.8.25;

// Core Fund Storage & Token
import {FundStorage} from "./FundStorage.sol";
import {InvestmentTokenM} from "../contracts/InvestmentTokenM.sol";

// OpenZeppelin Contracts
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title FundRedemptionModule
 * @dev Manages canonical per-request ERC-7540 asynchronous Day T redemption escrow,
 *      Day T+1 SCBAM settlement burning by refId, and single/batch cancellation refunds.
 */
abstract contract FundRedemptionModule is FundStorage {
    using SafeERC20 for IERC20;

    /**
     * @dev Step 1: Investor/Broker submits a redemption request on Day T.
     *
     * Requirements:
     * - caller must have {ALLOTMENT_ROLE}.
     */
    function requestRedeem(address wallet, uint256 amount, bytes32 refId)
        external
        onlyRole(ALLOTMENT_ROLE)
        nonReentrant
        whenNotPaused
    {
        if (amount == 0) revert ZeroAmount();
        if (_isRefIdUsed(refId)) revert RefIdAlreadyUsed(refId);

        bytes32 broker = _brokerOf(wallet);

        if (totalSharesByBroker[broker] < amount) {
            revert InsufficientReserve(amount, totalSharesByBroker[broker]);
        }

        totalShares -= amount;
        totalSharesByBroker[broker] -= amount;
        lockedForRedemption[broker] += amount;

        redemptionRequests[refId] = RedemptionRequest({
            wallet: wallet,
            broker: broker,
            amount: amount,
            requestedTimestamp: block.timestamp,
            resolvedTimestamp: 0,
            status: RedemptionStatus.PENDING
        });

        investmentToken.safeTransferFrom(wallet, address(this), amount);

        emit RedeemRequested(wallet, broker, amount, refId);
    }

    /**
     * @dev Step 2 (T+1 Settlement): SCBAM settles and burns an explicit batch of pending redemption requests.
     *
     * Requirements:
     * - caller must have {DEFAULT_ADMIN_ROLE}.
     * - batch must not be empty.
     * - all referenced refIds must be in {PENDING} status.
     */
    function settleRedemptions(bytes32[] calldata refIds)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
        whenNotPaused
    {
        if (refIds.length == 0) revert EmptyBatch();

        uint256 totalBurnAmount = 0;

        for (uint256 i = 0; i < refIds.length; i++) {
            bytes32 refId = refIds[i];
            RedemptionRequest storage req = redemptionRequests[refId];
            RedemptionStatus curStatus = req.status;

            if (curStatus == RedemptionStatus.NONE) {
                revert RedemptionNotFound(refId);
            }
            if (curStatus != RedemptionStatus.PENDING) {
                revert RedemptionNotPending(refId, curStatus);
            }

            req.status = RedemptionStatus.SETTLED;
            req.resolvedTimestamp = block.timestamp;

            lockedForRedemption[req.broker] -= req.amount;
            totalBurnAmount += req.amount;
        }

        // State changes precede external token call
        InvestmentTokenM(address(investmentToken)).burn(totalBurnAmount);

        emit RedemptionsSettled(refIds, totalBurnAmount, msg.sender);
    }

    /**
     * @dev Cancels a pending redemption request before T+1 settlement and returns tokens to the stored wallet.
     *
     * Requirements:
     * - caller must have {DEFAULT_ADMIN_ROLE}.
     */
    function cancelRedeem(bytes32 refId)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
        whenNotPaused
    {
        _cancelRedemption(refId);
    }

    /**
     * @dev Batch cancel multiple pending redemption requests by refIds in one transaction.
     *
     * Requirements:
     * - caller must have {DEFAULT_ADMIN_ROLE}.
     * - batch must not be empty.
     */
    function cancelRedeemBatch(bytes32[] calldata refIds)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
        whenNotPaused
    {
        if (refIds.length == 0) revert EmptyBatch();
        for (uint256 i = 0; i < refIds.length; i++) {
            _cancelRedemption(refIds[i]);
        }
    }

    function _cancelRedemption(bytes32 refId) internal {
        RedemptionRequest storage req = redemptionRequests[refId];
        RedemptionStatus curStatus = req.status;

        if (curStatus == RedemptionStatus.NONE) {
            revert RedemptionNotFound(refId);
        }
        if (curStatus != RedemptionStatus.PENDING) {
            revert RedemptionNotPending(refId, curStatus);
        }

        req.status = RedemptionStatus.CANCELLED;
        req.resolvedTimestamp = block.timestamp;

        lockedForRedemption[req.broker] -= req.amount;
        totalShares += req.amount;
        totalSharesByBroker[req.broker] += req.amount;

        investmentToken.safeTransfer(req.wallet, req.amount);

        emit RedeemCancelled(req.wallet, req.broker, req.amount, refId);
    }
}
