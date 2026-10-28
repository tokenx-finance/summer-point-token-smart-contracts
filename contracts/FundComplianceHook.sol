// SPDX-License-Identifier: GPL-2.0-or-later
// TokenX Contracts v1.0.4 (contracts/FundComplianceHook.sol)
pragma solidity 0.8.25;

// Local Interfaces
import {ITransferHook} from "../interfaces/ITransferHook.sol";
import {IFundController} from "../interfaces/IFundController.sol";
import {IBrokerCorridorGateway} from "../interfaces/IBrokerCorridorGateway.sol";

// OpenZeppelin Contracts
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title FundComplianceHook
 * @dev External lifecycle transfer hook for {InvestmentTokenM}.
 *      Encapsulates all regulatory compliance gating:
 *       - Broker Corridor Gateway validation
 *       - Minimum 10 tMMF holding enforcement
 *       - Automatic cross-broker ledger synchronization with {FundController}
 *
 * This contract uses {Ownable} for administrative configuration.
 */
contract FundComplianceHook is
    // Access Control & Administration
    Ownable,
    // Transfer Lifecycle Hook Interface
    ITransferHook
{
    address public investmentToken;
    address public corridorGateway;
    address public fundController;

    uint256 public minHoldingAmount;
    bool public minHoldingCheckEnabled;

    /**
     * @dev Emitted when the investment token address is updated.
     */
    event InvestmentTokenSet(address indexed token);

    /**
     * @dev Emitted when the broker corridor gateway address is updated.
     */
    event CorridorGatewaySet(address indexed gateway);

    /**
     * @dev Emitted when the fund controller address is updated.
     */
    event FundControllerSet(address indexed controller);

    /**
     * @dev Emitted when the minimum holding rule configuration is updated.
     */
    event MinHoldingConfigSet(uint256 minHoldingAmount, bool enabled);

    error MinimumHoldingRequired(address account, uint256 postBalance);
    error OnlyInvestmentToken();

    /**
     * @dev Throws if called by any account other than the authorized investment token.
     */
    modifier onlyToken() {
        if (_msgSender() != investmentToken) revert OnlyInvestmentToken();
        _;
    }

    constructor(
        address token_,
        address corridorGateway_,
        address fundController_
    ) {
        investmentToken = token_;
        corridorGateway = corridorGateway_;
        fundController = fundController_;
    }

    /**
     * @dev Sets the investment token contract address.
     * @param token_ Address of the investment token.
     *
     * Requirements:
     * - the caller must be owner.
     */
    function setInvestmentToken(address token_) external onlyOwner {
        investmentToken = token_;
        emit InvestmentTokenSet(token_);
    }

    /**
     * @dev Sets the broker corridor gateway contract address.
     * @param gateway_ Address of the broker corridor gateway.
     *
     * Requirements:
     * - the caller must be owner.
     */
    function setCorridorGateway(address gateway_) external onlyOwner {
        corridorGateway = gateway_;
        emit CorridorGatewaySet(gateway_);
    }

    /**
     * @dev Sets the fund controller contract address.
     * @param controller_ Address of the fund controller vault.
     *
     * Requirements:
     * - the caller must be owner.
     */
    function setFundController(address controller_) external onlyOwner {
        fundController = controller_;
        emit FundControllerSet(controller_);
    }

    /**
     * @dev Sets the minimum holding rule configuration.
     * @param amount Minimum holding threshold amount (in token wei).
     * @param enabled Flag indicating whether the minimum holding check is active.
     *
     * Requirements:
     * - the caller must be owner.
     */
    function setMinHoldingConfig(uint256 amount, bool enabled) external onlyOwner {
        minHoldingAmount = amount;
        minHoldingCheckEnabled = enabled;
        emit MinHoldingConfigSet(amount, enabled);
    }

    /**
     * @dev Hook that is called before any token transfer.
     * @param caller The initiator of the token transfer.
     * @param from The token sender address.
     * @param to The token recipient address.
     * @param amount The quantity of tokens being transferred.
     *
     * Enforces:
     *  1. Broker Corridor Gateway access rules
     *  2. Minimum holding balance requirement
     */
    function beforeTokenTransfer(
        address caller,
        address from,
        address to,
        uint256 amount
    ) external view override onlyToken {
        // 1. Corridor check: skip minting, burning, owner, or fundController transfers
        if (from != address(0) && to != address(0)) {
            if (
                corridorGateway != address(0) &&
                from != fundController &&
                to != fundController &&
                from != owner() &&
                to != owner() &&
                caller != fundController
            ) {
                IBrokerCorridorGateway(corridorGateway).checkTransfer(from, to);
            }
        }

        // 2. Minimum holding check: post-transfer balance cannot be strictly between 0 and minHoldingAmount
        if (
            minHoldingCheckEnabled &&
            minHoldingAmount > 0 &&
            from != fundController &&
            to != fundController &&
            caller != fundController
        ) {
            IERC20 token = IERC20(investmentToken);

            // Check sender (from)
            if (from != address(0) && from != owner()) {
                uint256 currentFrom = token.balanceOf(from);
                if (currentFrom >= amount) {
                    uint256 postFrom = currentFrom - amount;
                    if (postFrom > 0 && postFrom < minHoldingAmount) {
                        revert MinimumHoldingRequired(from, postFrom);
                    }
                }
            }

            // Check recipient (to)
            if (to != address(0) && to != owner()) {
                uint256 postTo = token.balanceOf(to) + amount;
                if (postTo > 0 && postTo < minHoldingAmount) {
                    revert MinimumHoldingRequired(to, postTo);
                }
            }
        }
    }

    /**
     * @dev Hook that is called after any token transfer.
     * @param from The token sender address.
     * @param to The token recipient address.
     * @param amount The quantity of tokens being transferred.
     *
     * Automatically synchronizes per-broker active share ledgers on {FundController}
     * when tokens move across different broker corridors.
     */
    function afterTokenTransfer(
        address /* caller */,
        address from,
        address to,
        uint256 amount
    ) external override onlyToken {
        // Synchronize per-broker ledger on FundController if tokens move across brokers
        if (
            from != address(0) &&
            to != address(0) &&
            from != fundController &&
            to != fundController &&
            from != owner() &&
            to != owner() &&
            corridorGateway != address(0) &&
            fundController != address(0)
        ) {
            bytes32 brokerFrom = IBrokerCorridorGateway(corridorGateway).walletBroker(from);
            bytes32 brokerTo = IBrokerCorridorGateway(corridorGateway).walletBroker(to);

            if (brokerFrom != bytes32(0) && brokerTo != bytes32(0) && brokerFrom != brokerTo && amount > 0) {
                IFundController(fundController).syncBrokerShares(brokerFrom, brokerTo, amount);
            }
        }
    }
}
