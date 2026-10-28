// SPDX-License-Identifier: GPL-2.0-or-later
// TokenX Contracts v1.1.0 (contracts/FundController.sol)
pragma solidity 0.8.25;

// Local Interfaces
import {IWalletBrokerRegistry} from "../interfaces/IWalletBrokerRegistry.sol";

// Core Extensions & Fund Modules
import {FundNavModule} from "../extensions/FundNavModule.sol";
import {FundStorage} from "../extensions/FundStorage.sol";
import {FundReserveModule} from "../extensions/FundReserveModule.sol";
import {FundRedemptionModule} from "../extensions/FundRedemptionModule.sol";
import {FundSubscriptionModule} from "../extensions/FundSubscriptionModule.sol";

/**
 * @title FundController
 * @dev Modular on-chain orchestrator for institutional tokenized mutual funds (tMMF).
 *
 * Inherited Extensions:
 * - {FundStorage}: Shared state, events, errors, and broker registry resolution.
 * - {FundReserveModule}: Vault reserves, broker liquidity buffers, and cross-broker P2P ledger sync.
 * - {FundSubscriptionModule}: 3-State FIFO subscription queue, batch processing, and direct allotment.
 * - {FundNavModule}: Daily NAV updates, oracle guards, and automated push yield distributions.
 * - {FundRedemptionModule}: ERC-7540 asynchronous Day T redemption escrow and Day T+1 lumpsum burns.
 */
contract FundController is
    // Liquidity & Broker Buffer Management
    FundReserveModule,
    // 3-State FIFO Subscription Queue & Allotment
    FundSubscriptionModule,
    // Daily NAV Growth & Push Distribution Engine
    FundNavModule,
    // Asynchronous Day T/T+1 Redemption Settlement
    FundRedemptionModule
{
    constructor(address investmentToken_, address admin_)
        FundStorage(investmentToken_, admin_)
    {}

    // ---------------------------------------------------------------
    // Administration & Configuration
    // ---------------------------------------------------------------

    /**
     * @dev Sets the wallet-to-broker registry address.
     * @param registry Address of the deployed broker registry contract.
     *
     * Requirements:
     * - caller must have {DEFAULT_ADMIN_ROLE}.
     * - `registry` must be a contract address with deployed code.
     */
    function setBrokerRegistry(address registry) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (registry.code.length == 0) revert InvalidBrokerRegistry(registry);
        brokerRegistry = IWalletBrokerRegistry(registry);
    }

    /**
     * @dev Sets the compliance hook authorized to sync cross-broker ledger movements.
     * @param hook_ Address of the deployed compliance hook contract.
     *
     * Requirements:
     * - caller must have {DEFAULT_ADMIN_ROLE}.
     * - `hook_` must be a contract address with deployed code.
     */
    function setComplianceHook(address hook_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (hook_.code.length == 0) revert InvalidComplianceHook(hook_);
        complianceHook = hook_;
    }

    /**
     * @dev Pauses all distribution, subscription, and allotment operations.
     *
     * Requirements:
     * - caller must have {DEFAULT_ADMIN_ROLE}.
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @dev Unpauses the contract operations.
     *
     * Requirements:
     * - caller must have {DEFAULT_ADMIN_ROLE}.
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
