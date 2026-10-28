// SPDX-License-Identifier: GPL-2.0-or-later
// TokenX Contracts (extensions/FundStorage.sol)
pragma solidity 0.8.25;

// Local Interfaces
import {IWalletBrokerRegistry} from "../interfaces/IWalletBrokerRegistry.sol";

// OpenZeppelin Contracts
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {DoubleEndedQueue} from "@openzeppelin/contracts/utils/structs/DoubleEndedQueue.sol";

/**
 * @title FundStorage
 * @dev Common state storage, roles, events, and errors for the FundController suite.
 */
abstract contract FundStorage is
    // Role-Based Access Control
    AccessControl,
    // Emergency Circuit Breakers & Reentrancy Protection
    Pausable,
    ReentrancyGuard
{
    using SafeERC20 for IERC20;
    using DoubleEndedQueue for DoubleEndedQueue.Bytes32Deque;

    bytes32 public constant NAV_UPDATER_ROLE = keccak256("NAV_UPDATER_ROLE");
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");
    bytes32 public constant ALLOTMENT_ROLE = keccak256("ALLOTMENT_ROLE");

    /// @notice The real investment token. Balances held by wallets ARE their shares.
    IERC20 public immutable investmentToken;

    /// @notice Percent-diff precision, matching the sheet's ROUND(...,10).
    uint256 public constant PRECISION = 1e10;

    // ---------------------------------------------------------------
    // 1. Subscription Order Management & FIFO Queue
    // ---------------------------------------------------------------

    enum SubscriptionStatus {
        NONE,        // 0: Order does not exist
        PENDING,     // 1: Waiting in FIFO queue for batch allotment
        CANCELLED,   // 2: Order cancelled before allotment
        SUCCESS      // 3: Shares allotted successfully to investor wallet
    }

    struct SubscriptionOrder {
        bytes32 refId;
        address wallet;
        bytes32 broker;
        uint256 amount;
        uint256 requestTimestamp;
        uint256 processedTimestamp;
        SubscriptionStatus status;
    }

    /// @notice refId => SubscriptionOrder canonical state
    mapping(bytes32 => SubscriptionOrder) public subscriptionOrders;

    /// @notice Active pending FIFO queue of subscription reference IDs
    DoubleEndedQueue.Bytes32Deque internal _pendingSubscriptionQueue;

    /// @notice Wallet => list of historical subscription refIds
    mapping(address => bytes32[]) internal _investorSubscriptions;

    /// @notice Aggregate volume counters per broker
    mapping(bytes32 => uint256) public pendingSubscriptionVolume;
    mapping(bytes32 => uint256) public successSubscriptionVolume;
    mapping(bytes32 => uint256) public cancelledSubscriptionVolume;

    /// @notice Aggregate order counters per broker
    mapping(bytes32 => uint256) public pendingSubscriptionCount;
    mapping(bytes32 => uint256) public successSubscriptionCount;
    mapping(bytes32 => uint256) public cancelledSubscriptionCount;

    // ---------------------------------------------------------------
    // 2. NAV Cycle State
    // ---------------------------------------------------------------

    struct NavCycle {
        uint256 oldNav;             // total fund NAV before this cycle (baht)
        uint256 newNav;             // total fund NAV after this cycle
        uint256 diffPercentScaled;  // (newNav - oldNav) * PRECISION / oldNav
        uint256 snapshotBlock;      // block captured by the committed off-chain report
        bytes32 reportHash;         // hash of the authoritative CSV report
        bool set;                   // true once updateNav() has been called for this cycle
    }

    /// @notice cycleId -> cycle data.
    mapping(uint256 => NavCycle) public cycles;

    /// @notice Latest NAV on record, carried forward as `oldNav` for the next cycle.
    uint256 public latestNav;

    /// @notice Most recently finalized cycle, for convenience/off-chain polling.
    uint256 public latestCycleId;

    /// @notice Idempotency guard for NAV-growth distribution: keccak256(wallet, cycleId) -> processed.
    mapping(bytes32 => bool) public processed;

    /// @notice Per-cycle aggregate distributed yield for reconciliation.
    mapping(uint256 => uint256) public totalDistributedInCycle;

    // ---------------------------------------------------------------
    // 3. Vault Balances & Per-Broker Ledgers
    // ---------------------------------------------------------------

    /// @notice Idempotency guard for direct allotment refId.
    mapping(bytes32 => bool) public allotmentProcessed;

    /// @notice Aggregate active circulating shares across all holders.
    uint256 public totalShares;

    /// @notice Per-broker active share ledger breakdown.
    mapping(bytes32 => uint256) public totalSharesByBroker;

    /// @notice Global reserve not allocated to any broker.
    uint256 public unallocatedReserve;

    /// @notice Isolated reserve pool per broker.
    mapping(bytes32 => uint256) public brokerReserve;

    /// @notice Wallet -> broker registry, shared with BrokerCorridorGateway.
    IWalletBrokerRegistry public brokerRegistry;

    /// @notice Compliance hook address authorized to sync peer-to-peer cross-broker transfers
    address public complianceHook;

    // ---------------------------------------------------------------
    // 4. Redemption State
    // ---------------------------------------------------------------

    enum RedemptionStatus {
        NONE,        // 0: Request does not exist
        PENDING,     // 1: Escrowed in vault awaiting T+1 settlement burn
        CANCELLED,   // 2: Cancelled and refunded to investor wallet
        SETTLED      // 3: Burned and settled at T+1
    }

    struct RedemptionRequest {
        address wallet;
        bytes32 broker;
        uint256 amount;
        uint256 requestedTimestamp;
        uint256 resolvedTimestamp;
        RedemptionStatus status;
    }

    /// @notice Broker => amount of tMMF locked in controller awaiting T+1 settlement burn
    mapping(bytes32 => uint256) public lockedForRedemption;

    /// @notice refId => canonical RedemptionRequest state
    mapping(bytes32 => RedemptionRequest) public redemptionRequests;

    // ---------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------

    event SubscriptionRequested(bytes32 indexed refId, address indexed wallet, bytes32 indexed broker, uint256 amount, uint256 timestamp);
    event SubscriptionCancelled(bytes32 indexed refId, address indexed wallet, bytes32 indexed broker, uint256 amount, uint256 timestamp);
    event SubscriptionSuccess(bytes32 indexed refId, address indexed wallet, bytes32 indexed broker, uint256 amount, uint256 timestamp);
    event NavUpdated(
        uint256 indexed cycleId,
        uint256 oldNav,
        uint256 newNav,
        uint256 diffPercentScaled,
        uint256 snapshotBlock,
        bytes32 reportHash,
        address indexed updater
    );
    event Distributed(address indexed wallet, uint256 indexed cycleId, uint256 reportedBalance, uint256 sharesEarned);
    event SharesAllotted(address indexed wallet, bytes32 indexed refId, uint256 amount);
    event ReserveFunded(address indexed from, uint256 amount);
    event ReserveSwept(address indexed to, uint256 amount);
    event BrokerReserveFunded(bytes32 indexed broker, address indexed from, uint256 amount);
    event BrokerReserveSwept(bytes32 indexed broker, address indexed to, uint256 amount);
    event BrokerReserveRebalanced(bytes32 indexed fromBroker, bytes32 indexed toBroker, uint256 amount, address indexed caller);
    event RedeemRequested(address indexed wallet, bytes32 indexed broker, uint256 amount, bytes32 indexed refId);
    event RedeemCancelled(address indexed wallet, bytes32 indexed broker, uint256 amount, bytes32 indexed refId);
    event RedemptionsSettled(bytes32[] refIds, uint256 totalAmount, address indexed caller);
    event BrokerSharesSynced(bytes32 indexed fromBroker, bytes32 indexed toBroker, uint256 amount);

    // ---------------------------------------------------------------
    // Custom Errors
    // ---------------------------------------------------------------

    error CycleAlreadySet(uint256 cycleId);
    error CycleNotSet(uint256 cycleId);
    error AlreadyDistributed(address wallet, uint256 cycleId);
    error AlreadyAllotted(bytes32 refId);
    error AlreadyRedeemed(bytes32 refId);
    error OrderAlreadyExists(bytes32 refId);
    error OrderNotPending(bytes32 refId, SubscriptionStatus currentStatus);
    error RedemptionAlreadyExists(bytes32 refId);
    error RedemptionNotFound(bytes32 refId);
    error RedemptionNotPending(bytes32 refId, RedemptionStatus currentStatus);
    error RefIdAlreadyUsed(bytes32 refId);
    error EmptyBatch();
    error NavCannotDecreaseViaOracle();
    error ZeroSnapshotBlock();
    error SnapshotBlockInFuture(uint256 snapshotBlock, uint256 currentBlock);
    error SnapshotBlockOutOfOrder(uint256 snapshotBlock, uint256 previousSnapshotBlock);
    error ZeroReportHash();
    error SameBroker(bytes32 broker);
    error FirstCycleRequiresBaseline();
    error InsufficientReserve(uint256 requested, uint256 available);
    error InsufficientLockedForRedemption(uint256 requested, uint256 available);
    error ZeroAmount();
    error ArrayLengthMismatch();
    error WalletNotRegisteredInBrokerRegistry(address wallet);
    error BrokerRegistryNotSet();
    error OnlyComplianceHook();
    error InsufficientBrokerShares(bytes32 broker, uint256 requested, uint256 available);
    error InvalidBrokerRegistry(address registry);
    error InvalidComplianceHook(address hook);

    constructor(address investmentToken_, address admin_) {
        if (investmentToken_ == address(0)) revert ZeroAmount();
        investmentToken = IERC20(investmentToken_);

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(NAV_UPDATER_ROLE, admin_);
        _grantRole(DISTRIBUTOR_ROLE, admin_);
        _grantRole(ALLOTMENT_ROLE, admin_);
    }

    /**
     * @dev Smallest coherent collision guard across controller workflows (Subscription, Allotment, Redemption).
     */
    function _isRefIdUsed(bytes32 refId) internal view returns (bool) {
        if (subscriptionOrders[refId].status != SubscriptionStatus.NONE) return true;
        if (allotmentProcessed[refId]) return true;
        if (redemptionRequests[refId].status != RedemptionStatus.NONE) return true;
        return false;
    }

    /**
     * @dev Resolves the broker associated with a wallet.
     */
    function _brokerOf(address wallet) internal view returns (bytes32) {
        if (address(brokerRegistry) == address(0)) {
            revert BrokerRegistryNotSet();
        }
        bytes32 broker = brokerRegistry.walletBroker(wallet);
        if (broker == bytes32(0)) {
            revert WalletNotRegisteredInBrokerRegistry(wallet);
        }
        return broker;
    }
}
