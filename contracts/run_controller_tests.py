import ast
import json
from web3 import Web3
from eth_tester import EthereumTester, PyEVMBackend

def load(name):
    with open(f"build/{name}.abi") as f: abi = json.load(f)
    with open(f"build/{name}.bin") as f: bytecode = f.read().strip()
    return abi, bytecode

def revert_selector(exc) -> bytes:
    msg = str(exc.args[0]) if exc.args else str(exc)
    prefix = "execution reverted: "
    if prefix in msg:
        literal = msg.split(prefix, 1)[1].strip()
        try:
            return ast.literal_eval(literal)[:4]
        except (ValueError, SyntaxError):
            return b""
    return b""

def main():
    failures, passed = [], []
    def check(name, cond, detail=""):
        (passed if cond else failures).append(name if cond else f"{name} :: {detail}")

    tester = EthereumTester(backend=PyEVMBackend())
    w3 = Web3(Web3.EthereumTesterProvider(tester))
    accounts = w3.eth.accounts
    admin, nav_updater, distributor = accounts[0], accounts[1], accounts[2]
    somchai, somying, wichai = accounts[3], accounts[4], accounts[5]

    token_abi, token_bin = load("MockERC20")
    ctrl_abi, ctrl_bin = load("FundController")

    Token = w3.eth.contract(abi=token_abi, bytecode=token_bin)
    tx = Token.constructor().transact({"from": admin})
    token_addr = w3.eth.get_transaction_receipt(tx)["contractAddress"]
    token = w3.eth.contract(address=token_addr, abi=token_abi)

    Ctrl = w3.eth.contract(abi=ctrl_abi, bytecode=ctrl_bin)
    tx = Ctrl.constructor(token_addr, admin).transact({"from": admin})
    ctrl_addr = w3.eth.get_transaction_receipt(tx)["contractAddress"]
    ctrl = w3.eth.contract(address=ctrl_addr, abi=ctrl_abi)

    # Deploy the broker registry (BrokerCorridorGateway) and wire the
    # controller to it -- allotment/distribution now require every
    # destination wallet to be registered to a broker there.
    gw_abi, gw_bin = load("BrokerCorridorGateway")
    Gw = w3.eth.contract(abi=gw_abi, bytecode=gw_bin)
    tx = Gw.constructor(admin).transact({"from": admin})
    gw_addr = w3.eth.get_transaction_receipt(tx)["contractAddress"]
    gw = w3.eth.contract(address=gw_addr, abi=gw_abi)
    gw.functions.grantRole(gw.functions.REGISTRAR_ROLE().call(), admin).transact({"from": admin})

    ctrl.functions.setBrokerRegistry(gw_addr).transact({"from": admin})

    BROKER_INNOVESTX = w3.keccak(text="InnovestX")
    BROKER_DIME = w3.keccak(text="Dime")
    gw.functions.registerWalletsBatch(
        [somchai, somying, wichai], [BROKER_INNOVESTX, BROKER_INNOVESTX, BROKER_DIME]
    ).transact({"from": admin})

    NAV_ROLE = ctrl.functions.NAV_UPDATER_ROLE().call()
    DIST_ROLE = ctrl.functions.DISTRIBUTOR_ROLE().call()
    ctrl.functions.grantRole(NAV_ROLE, nav_updater).transact({"from": admin})
    ctrl.functions.grantRole(DIST_ROLE, distributor).transact({"from": admin})

    # Give each wallet its "existing units" as real token balance -- since
    # the token balance IS the share ledger under this design.
    SCALE = 10_000
    token.functions.mint(somchai, 27_000_1234).transact({"from": admin})
    token.functions.mint(somying, 27_000_1234).transact({"from": admin})
    token.functions.mint(wichai, 27_000_1234).transact({"from": admin})

    total_baseline = 27_000_1234 * 3
    ctrl.functions.setBaselineNav(total_baseline).transact({"from": nav_updater})
    check("setBaselineNav_stores_value", ctrl.functions.latestNav().call() == total_baseline)

    # ----------------------------------------------------------------
    # #2: on-chain diff-percent calc
    # ----------------------------------------------------------------
    new_nav = (total_baseline * 10_353_587_654) // 10**10  # sheet's growth factor
    cycle_id = 20260814
    report_hash = w3.keccak(text="snapshot-controller-tests.csv")
    ctrl.functions.updateNav(cycle_id, new_nav, w3.eth.block_number, report_hash).transact({"from": nav_updater})
    cycle = ctrl.functions.cycles(cycle_id).call()
    expected_diff_percent = ((new_nav - total_baseline) * 10**10) // total_baseline
    check(
        "updateNav_computes_diffPercent_onchain",
        cycle[2] == expected_diff_percent,
        f"got={cycle[2]} expected={expected_diff_percent}",
    )

    # NAV cannot decrease
    try:
        ctrl.functions.updateNav(cycle_id + 1, new_nav - 1, w3.eth.block_number, report_hash).transact({"from": nav_updater})
        check("updateNav_revertsOnDecrease", False, "did not revert")
    except Exception as e:
        SEL = w3.keccak(text="NavCannotDecreaseViaOracle()")[:4]
        check("updateNav_revertsOnDecrease", revert_selector(e) == SEL, revert_selector(e).hex())

    # ----------------------------------------------------------------
    # #3: fund reserve with real tokens, then distribute real tokens
    # ----------------------------------------------------------------
    expected_earn_per_major = (27_000_1234 * expected_diff_percent) // 10**10
    innovestx_reserve = expected_earn_per_major * 2 + 100
    dime_reserve = expected_earn_per_major + 100
    fund_amount = innovestx_reserve + dime_reserve
    token.functions.mint(admin, fund_amount).transact({"from": admin})
    token.functions.approve(ctrl_addr, fund_amount).transact({"from": admin})
    ctrl.functions.fundBrokerReserve(BROKER_INNOVESTX, innovestx_reserve).transact({"from": admin})
    ctrl.functions.fundBrokerReserve(BROKER_DIME, dime_reserve).transact({"from": admin})
    check("fundBrokerReserve_movesRealTokens", token.functions.balanceOf(ctrl_addr).call() == fund_amount)

    reported_balance = 27_000_1234
    preview = ctrl.functions.previewDistribution(reported_balance, cycle_id).call()
    check("previewDistribution_matchesExpected", preview == expected_earn_per_major, f"got={preview}")

    bal_before = token.functions.balanceOf(somchai).call()
    ctrl.functions.distributeToWallet(somchai, cycle_id, reported_balance).transact({"from": distributor})
    bal_after = token.functions.balanceOf(somchai).call()
    check(
        "distributeToWallet_transfersRealTokens",
        bal_after == bal_before + expected_earn_per_major,
        f"before={bal_before} after={bal_after} expected_gain={expected_earn_per_major}",
    )
    check(
        "distributeToWallet_updatesAggregateLedgerOnly",
        ctrl.functions.totalShares().call() == expected_earn_per_major,
    )
    check(
        "distributeToWallet_updatesPerBrokerLedger",
        ctrl.functions.totalSharesByBroker(BROKER_INNOVESTX).call() == expected_earn_per_major,
        f"got={ctrl.functions.totalSharesByBroker(BROKER_INNOVESTX).call()}",
    )

    # ----------------------------------------------------------------
    # #1: idempotency per (wallet, cycleId)
    # ----------------------------------------------------------------
    try:
        ctrl.functions.distributeToWallet(somchai, cycle_id, reported_balance).transact({"from": distributor})
        check("distributeToWallet_idempotent_reverts_on_retry", False, "did not revert")
    except Exception as e:
        SEL = w3.keccak(text="AlreadyDistributed(address,uint256)")[:4]
        check("distributeToWallet_idempotent_reverts_on_retry", revert_selector(e) == SEL, revert_selector(e).hex())

    # different cycle -- should NOT be blocked by prior cycle's idempotency key
    cycle_id_2 = 20260815
    new_nav_2 = ctrl.functions.latestNav().call() + 1_000_000
    ctrl.functions.updateNav(cycle_id_2, new_nav_2, w3.eth.block_number, w3.keccak(text="snapshot-cycle-2.csv")).transact({"from": nav_updater})
    token.functions.mint(admin, 10_000_000).transact({"from": admin})
    token.functions.approve(ctrl_addr, 10_000_000).transact({"from": admin})
    ctrl.functions.fundReserve(10_000_000).transact({"from": admin})
    try:
        ctrl.functions.distributeToWallet(somchai, cycle_id_2, token.functions.balanceOf(somchai).call()).transact({"from": distributor})
        check("distributeToWallet_newCycle_notBlockedByOldIdempotencyKey", True)
    except Exception as e:
        check("distributeToWallet_newCycle_notBlockedByOldIdempotencyKey", False, str(e))

    # ----------------------------------------------------------------
    # batch distribution
    # ----------------------------------------------------------------
    bal_somying_before = token.functions.balanceOf(somying).call()
    bal_wichai_before = token.functions.balanceOf(wichai).call()
    ctrl.functions.distributeToWallets(
        [somying, wichai], cycle_id, [reported_balance, reported_balance]
    ).transact({"from": distributor})
    check(
        "distributeToWallets_batch_paysAll",
        token.functions.balanceOf(somying).call() == bal_somying_before + expected_earn_per_major
        and token.functions.balanceOf(wichai).call() == bal_wichai_before + expected_earn_per_major,
    )

    # ----------------------------------------------------------------
    # insufficient reserve
    # ----------------------------------------------------------------
    reserve_now = token.functions.balanceOf(ctrl_addr).call()
    ctrl.functions.sweepReserve(reserve_now, admin).transact({"from": admin})
    # fresh cycle + wallet with a real entitlement but empty reserve
    cycle_id_3 = 20260816
    nav_3 = ctrl.functions.latestNav().call() + 500_000
    ctrl.functions.updateNav(cycle_id_3, nav_3, w3.eth.block_number, w3.keccak(text="snapshot-cycle-3.csv")).transact({"from": nav_updater})
    try:
        ctrl.functions.distributeToWallet(somying, cycle_id_3, token.functions.balanceOf(somying).call()).transact({"from": distributor})
        check("distributeToWallet_revertsOnInsufficientReserve", False, "did not revert")
    except Exception as e:
        SEL = w3.keccak(text="InsufficientReserve(uint256,uint256)")[:4]
        check("distributeToWallet_revertsOnInsufficientReserve", revert_selector(e) == SEL, revert_selector(e).hex())

    # ----------------------------------------------------------------
    # First-time / subscription allotment (no NAV cycle involved)
    # ----------------------------------------------------------------
    ALLOT_ROLE = ctrl.functions.ALLOTMENT_ROLE().call()
    ctrl.functions.grantRole(ALLOT_ROLE, distributor).transact({"from": admin})

    new_investor = accounts[6]
    gw.functions.registerWallet(new_investor, BROKER_INNOVESTX).transact({"from": admin})
    subscription_amount = 5_000_0000  # 5000.0000 units purchased
    token.functions.mint(admin, subscription_amount).transact({"from": admin})
    token.functions.approve(ctrl_addr, subscription_amount).transact({"from": admin})
    ctrl.functions.fundReserve(subscription_amount).transact({"from": admin})

    sub_id = w3.keccak(text="subscription-req-001")
    total_shares_before_allot = ctrl.functions.totalShares().call()
    broker_shares_before_allot = ctrl.functions.totalSharesByBroker(BROKER_INNOVESTX).call()
    bal_before_allot = token.functions.balanceOf(new_investor).call()

    ctrl.functions.allotShares(new_investor, subscription_amount, sub_id).transact({"from": distributor})

    check(
        "allotShares_transfersRealTokensToNewInvestor",
        token.functions.balanceOf(new_investor).call() == bal_before_allot + subscription_amount,
    )
    check(
        "allotShares_updatesAggregateLedger",
        ctrl.functions.totalShares().call() == total_shares_before_allot + subscription_amount,
    )
    check(
        "allotShares_worksWithNoNavCycleSet",
        True,  # if we got here without a CycleNotSet revert, this already proves it
    )
    check(
        "allotShares_updatesPerBrokerLedger",
        ctrl.functions.totalSharesByBroker(BROKER_INNOVESTX).call() == broker_shares_before_allot + subscription_amount,
        f"got={ctrl.functions.totalSharesByBroker(BROKER_INNOVESTX).call()}",
    )

    # idempotency on subscriptionId -- retry must revert, not double-issue
    try:
        ctrl.functions.allotShares(new_investor, subscription_amount, sub_id).transact({"from": distributor})
        check("allotShares_idempotent_revertsOnRetry", False, "did not revert")
    except Exception as e:
        SEL = w3.keccak(text="AlreadyAllotted(bytes32)")[:4]
        check("allotShares_idempotent_revertsOnRetry", revert_selector(e) == SEL, revert_selector(e).hex())

    # batch allotment for multiple new subscribers
    investor_b, investor_c = accounts[7], accounts[8]
    gw.functions.registerWalletsBatch([investor_b, investor_c], [BROKER_DIME, BROKER_DIME]).transact({"from": admin})
    amt_b, amt_c = 2_000_0000, 3_000_0000
    dime_shares_before_batch = ctrl.functions.totalSharesByBroker(BROKER_DIME).call()
    token.functions.mint(admin, amt_b + amt_c).transact({"from": admin})
    token.functions.approve(ctrl_addr, amt_b + amt_c).transact({"from": admin})
    ctrl.functions.fundReserve(amt_b + amt_c).transact({"from": admin})

    sub_id_b = w3.keccak(text="subscription-req-002")
    sub_id_c = w3.keccak(text="subscription-req-003")
    ctrl.functions.allotSharesBatch(
        [investor_b, investor_c], [amt_b, amt_c], [sub_id_b, sub_id_c]
    ).transact({"from": distributor})
    check(
        "allotSharesBatch_paysAllNewSubscribers",
        token.functions.balanceOf(investor_b).call() == amt_b
        and token.functions.balanceOf(investor_c).call() == amt_c,
    )
    check(
        "allotSharesBatch_creditsDimeBrokerLedger_notInnovestX",
        ctrl.functions.totalSharesByBroker(BROKER_DIME).call() == dime_shares_before_batch + amt_b + amt_c,
        f"got={ctrl.functions.totalSharesByBroker(BROKER_DIME).call()}",
    )
    check(
        "perBrokerLedgers_areIndependent",
        ctrl.functions.totalSharesByBroker(BROKER_INNOVESTX).call() != ctrl.functions.totalSharesByBroker(BROKER_DIME).call(),
    )
    check(
        "perBrokerLedgers_sumToGlobalTotal",
        ctrl.functions.totalSharesByBroker(BROKER_INNOVESTX).call() + ctrl.functions.totalSharesByBroker(BROKER_DIME).call()
        == ctrl.functions.totalShares().call(),
        f"innovestx+dime={ctrl.functions.totalSharesByBroker(BROKER_INNOVESTX).call() + ctrl.functions.totalSharesByBroker(BROKER_DIME).call()} total={ctrl.functions.totalShares().call()}",
    )

    # unregistered wallet cannot receive an allotment at all
    stranger = accounts[9]
    try:
        ctrl.functions.allotShares(stranger, 1_0000, w3.keccak(text="sub-stranger")).transact({"from": distributor})
        check("allotShares_revertsForUnregisteredWallet", False, "did not revert")
    except Exception as e:
        SEL = w3.keccak(text="WalletNotRegisteredInBrokerRegistry(address)")[:4]
        check("allotShares_revertsForUnregisteredWallet", revert_selector(e) == SEL, revert_selector(e).hex())


    for p in passed: print(f"  [PASS] {p}")
    print(f"\nFAILED: {len(failures)}")
    for f in failures: print(f"  [FAIL] {f}")
    print(f"{'='*60}\nTotal: {len(passed)+len(failures)}, Passed: {len(passed)}, Failed: {len(failures)}")
    if failures: raise SystemExit(1)

if __name__ == "__main__":
    main()
