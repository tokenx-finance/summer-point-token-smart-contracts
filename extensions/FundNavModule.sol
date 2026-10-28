// SPDX-License-Identifier: GPL-2.0-or-later
// TokenX Contracts (extensions/FundNavModule.sol)
pragma solidity 0.8.25;

// Core Fund Storage
import {FundStorage} from "./FundStorage.sol";

// OpenZeppelin Contracts
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title FundNavModule
 * @dev Manages daily NAV growth calculation, non-decreasing oracle enforcement,
 *      and automated push yield distribution to investor wallets.
 */
abstract contract FundNavModule is FundStorage {
    using SafeERC20 for IERC20;

    /**
     * @dev Sets the initial NAV baseline before the very first daily cycle.
     *
     * Requirements:
     * - caller must have {NAV_UPDATER_ROLE}.
     */
    function setBaselineNav(uint256 baselineNav) external onlyNavUpdaterOrAM {
        if (baselineNav == 0) revert ZeroAmount();
        if (latestNav != 0) revert CycleAlreadySet(0);
        latestNav = baselineNav;
    }

    /**
     * @dev Publishes today's new NAV for a cycle.
     *
     * Requirements:
     * - caller must have {NAV_UPDATER_ROLE} or {AM_ROLE}.
     */
    function updateNav(uint256 cycleId, uint256 newNav, uint256 snapshotBlock, bytes32 reportHash)
        external
        onlyNavUpdaterOrAM
        whenNotPaused
    {
        if (cycles[cycleId].set) revert CycleAlreadySet(cycleId);
        if (latestNav == 0) revert FirstCycleRequiresBaseline();
        if (newNav < latestNav) revert NavCannotDecreaseViaOracle();
        if (snapshotBlock == 0) revert ZeroSnapshotBlock();
        if (snapshotBlock > block.number) revert SnapshotBlockInFuture(snapshotBlock, block.number);
        if (cycles[latestCycleId].set && snapshotBlock < cycles[latestCycleId].snapshotBlock) {
            revert SnapshotBlockOutOfOrder(snapshotBlock, cycles[latestCycleId].snapshotBlock);
        }
        if (reportHash == bytes32(0)) revert ZeroReportHash();

        uint256 oldNav = latestNav;
        uint256 diffPercentScaled = ((newNav - oldNav) * PRECISION) / oldNav;

        cycles[cycleId] = NavCycle({
            oldNav: oldNav,
            newNav: newNav,
            diffPercentScaled: diffPercentScaled,
            snapshotBlock: snapshotBlock,
            reportHash: reportHash,
            set: true
        });

        latestNav = newNav;
        latestCycleId = cycleId;

        emit NavUpdated(cycleId, oldNav, newNav, diffPercentScaled, snapshotBlock, reportHash, msg.sender);
    }

    /**
     * @dev Preview a wallet's entitlement for a cycle without state change.
     */
    function previewDistribution(uint256 reportedBalance, uint256 cycleId) public view returns (uint256 sharesEarned) {
        NavCycle memory cycle = cycles[cycleId];
        if (!cycle.set) revert CycleNotSet(cycleId);
        sharesEarned = (reportedBalance * cycle.diffPercentScaled) / PRECISION; // floor
    }

    /**
     * @dev Credits one wallet's share of this cycle's NAV growth.
     *
     * Requirements:
     * - caller must have {DISTRIBUTOR_ROLE}.
     */
    function distributeToWallet(address wallet, uint256 cycleId, uint256 reportedBalance)
        external
        onlyDistributorOrSellingAgent
        nonReentrant
        whenNotPaused
        returns (uint256 sharesEarned)
    {
        sharesEarned = _distribute(wallet, cycleId, reportedBalance);
    }

    /**
     * @dev Batch version to process many wallets in one transaction.
     *
     * Requirements:
     * - caller must have {DISTRIBUTOR_ROLE} or {SELLING_AGENT_ROLE}.
     */
    function distributeToWallets(address[] calldata wallets, uint256 cycleId, uint256[] calldata reportedBalances)
        external
        onlyDistributorOrSellingAgent
        nonReentrant
        whenNotPaused
        returns (uint256 totalEarned)
    {
        if (wallets.length != reportedBalances.length) revert ArrayLengthMismatch();
        for (uint256 i = 0; i < wallets.length; i++) {
            totalEarned += _distribute(wallets[i], cycleId, reportedBalances[i]);
        }
    }

    function _distribute(address wallet, uint256 cycleId, uint256 reportedBalance) internal returns (uint256 sharesEarned) {
        NavCycle memory cycle = cycles[cycleId];
        if (!cycle.set) revert CycleNotSet(cycleId);

        bytes32 key = keccak256(abi.encodePacked(wallet, cycleId));
        if (processed[key]) revert AlreadyDistributed(wallet, cycleId);

        bytes32 broker = _brokerOf(wallet);
        sharesEarned = (reportedBalance * cycle.diffPercentScaled) / PRECISION; // floor

        processed[key] = true;

        if (sharesEarned > 0) {
            uint256 available = brokerReserve[broker];
            if (sharesEarned > available) revert InsufficientReserve(sharesEarned, available);
            brokerReserve[broker] = available - sharesEarned;

            totalShares += sharesEarned;
            totalSharesByBroker[broker] += sharesEarned;
            totalDistributedInCycle[cycleId] += sharesEarned;

            investmentToken.safeTransfer(wallet, sharesEarned);
        }

        emit Distributed(wallet, cycleId, reportedBalance, sharesEarned);
    }
}
