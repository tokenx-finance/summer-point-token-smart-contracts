import ast, json
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
    admin = accounts[0]

    abi, bytecode = load("BrokerCorridorGateway")
    C = w3.eth.contract(abi=abi, bytecode=bytecode)
    tx = C.constructor(admin).transact({"from": admin})
    addr = w3.eth.get_transaction_receipt(tx)["contractAddress"]
    gw = w3.eth.contract(address=addr, abi=abi)

    REGISTRAR = gw.functions.REGISTRAR_ROLE().call()
    CORRIDOR_ADMIN = gw.functions.CORRIDOR_ADMIN_ROLE().call()
    gw.functions.grantRole(REGISTRAR, admin).transact({"from": admin})
    gw.functions.grantRole(CORRIDOR_ADMIN, admin).transact({"from": admin})

    # 4 brokers -- more than 2, the actual question being tested
    BROKER_A = w3.keccak(text="InnovestX")
    BROKER_B = w3.keccak(text="Dime")
    BROKER_C = w3.keccak(text="Broker C")
    BROKER_D = w3.keccak(text="Broker D")

    wallets = accounts[1:9]  # 8 wallets, 2 per broker
    brokers_for_wallets = [BROKER_A, BROKER_A, BROKER_B, BROKER_B, BROKER_C, BROKER_C, BROKER_D, BROKER_D]
    gw.functions.registerWalletsBatch(wallets, brokers_for_wallets).transact({"from": admin})

    wA1, wA2, wB1, wB2, wC1, wC2, wD1, wD2 = wallets

    # ----------------------------------------------------------------
    # Same-broker always works, regardless of corridor state
    # ----------------------------------------------------------------
    check("sameBroker_A_alwaysAllowed", gw.functions.isTransferAllowed(wA1, wA2).call())
    check("sameBroker_D_alwaysAllowed", gw.functions.isTransferAllowed(wD1, wD2).call())

    # ----------------------------------------------------------------
    # No corridors set yet -- all cross-broker pairs blocked
    # ----------------------------------------------------------------
    check("crossBroker_A_to_B_blockedByDefault", not gw.functions.isTransferAllowed(wA1, wB1).call())
    check("crossBroker_A_to_C_blockedByDefault", not gw.functions.isTransferAllowed(wA1, wC1).call())
    check("crossBroker_C_to_D_blockedByDefault", not gw.functions.isTransferAllowed(wC1, wD1).call())

    # ----------------------------------------------------------------
    # Open ONE specific corridor (A<->B), leave others closed --
    # proves corridors are independently controllable per-pair, not
    # an all-or-nothing global toggle
    # ----------------------------------------------------------------
    gw.functions.setCorridor(BROKER_A, BROKER_B, True).transact({"from": admin})
    check("corridorAB_symmetric_forward", gw.functions.isTransferAllowed(wA1, wB1).call())
    check("corridorAB_symmetric_backward", gw.functions.isTransferAllowed(wB1, wA1).call())
    check("corridorAC_stillBlocked_afterOpeningAB", not gw.functions.isTransferAllowed(wA1, wC1).call())
    check("corridorCD_stillBlocked_afterOpeningAB", not gw.functions.isTransferAllowed(wC1, wD1).call())
    check("corridorBD_stillBlocked_afterOpeningAB", not gw.functions.isTransferAllowed(wB1, wD1).call())

    # ----------------------------------------------------------------
    # Open a SECOND, independent corridor (C<->D) -- proves the mesh
    # isn't limited to one active corridor at a time
    # ----------------------------------------------------------------
    gw.functions.setCorridor(BROKER_C, BROKER_D, True).transact({"from": admin})
    check("corridorCD_nowOpen", gw.functions.isTransferAllowed(wC1, wD1).call())
    check("corridorAB_stillOpen_bothActiveSimultaneously", gw.functions.isTransferAllowed(wA1, wB1).call())
    check("corridorAD_stillBlocked_notATransitiveOpen", not gw.functions.isTransferAllowed(wA1, wD1).call())
    check("corridorBC_stillBlocked_notATransitiveOpen", not gw.functions.isTransferAllowed(wB1, wC1).call())

    # ----------------------------------------------------------------
    # Directional-only corridor: A -> D allowed, D -> A NOT allowed
    # ----------------------------------------------------------------
    gw.functions.setCorridorDirectional(BROKER_A, BROKER_D, True).transact({"from": admin})
    check("directionalCorridor_forwardAllowed", gw.functions.isTransferAllowed(wA1, wD1).call())
    check("directionalCorridor_backwardStillBlocked", not gw.functions.isTransferAllowed(wD1, wA1).call())

    # ----------------------------------------------------------------
    # checkTransfer() reverts (not just returns false) when blocked --
    # this is the form the token hook would actually call
    # ----------------------------------------------------------------
    try:
        gw.functions.checkTransfer(wB1, wC1).call()
        check("checkTransfer_revertsOnBlockedCorridor", False, "did not revert")
    except Exception as e:
        SEL = w3.keccak(text="CrossBrokerTransferNotAllowed(address,address,bytes32,bytes32)")[:4]
        check("checkTransfer_revertsOnBlockedCorridor", revert_selector(e) == SEL, revert_selector(e).hex())

    gw.functions.checkTransfer(wA1, wB1).call()  # should NOT revert
    check("checkTransfer_passesOnOpenCorridor", True)

    # ----------------------------------------------------------------
    # Close a corridor after opening it -- proves it's not one-way-only
    # ----------------------------------------------------------------
    gw.functions.setCorridor(BROKER_A, BROKER_B, False).transact({"from": admin})
    check("corridorAB_canBeClosedAgain", not gw.functions.isTransferAllowed(wA1, wB1).call())
    check("corridorCD_unaffectedByClosingAB", gw.functions.isTransferAllowed(wC1, wD1).call())

    # ----------------------------------------------------------------
    # Global unlock -- opens ALL cross-broker pairs, including ones
    # that never had an explicit corridor set (B<->C, e.g.)
    # ----------------------------------------------------------------
    check("globalUnlock_BC_blockedBeforeUnlock", not gw.functions.isTransferAllowed(wB1, wC1).call())
    gw.functions.setGlobalUnlock(True).transact({"from": admin})
    check("globalUnlock_opensNeverConfiguredPair_BC", gw.functions.isTransferAllowed(wB1, wC1).call())
    check("globalUnlock_opensClosedPair_AB", gw.functions.isTransferAllowed(wA1, wB1).call())
    check("globalUnlock_allBrokerPairsNowOpen", all(
        gw.functions.isTransferAllowed(x, y).call()
        for x in [wA1, wB1, wC1, wD1] for y in [wA1, wB1, wC1, wD1] if x != y
    ))

    # ----------------------------------------------------------------
    # Unregistered wallet always blocked, even under global unlock
    # ----------------------------------------------------------------
    stranger = accounts[9]
    check("unregisteredWallet_blockedEvenUnderGlobalUnlock", not gw.functions.isTransferAllowed(wA1, stranger).call())

    print(f"\n{'='*60}\nPASSED: {len(passed)}")
    for p in passed: print(f"  [PASS] {p}")
    print(f"\nFAILED: {len(failures)}")
    for f in failures: print(f"  [FAIL] {f}")
    print(f"{'='*60}\nTotal: {len(passed)+len(failures)}, Passed: {len(passed)}, Failed: {len(failures)}")
    if failures: raise SystemExit(1)

if __name__ == "__main__":
    main()
