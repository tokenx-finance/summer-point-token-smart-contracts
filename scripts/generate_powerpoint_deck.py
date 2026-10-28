import sys
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

def create_deck():
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank_layout = prs.slide_layouts[6]

    # Color Palette - Modern Institutional Tech
    NAVY_DARK = RGBColor(15, 23, 42)      # Slate 900
    NAVY_CARD = RGBColor(30, 41, 59)      # Slate 800
    BLUE_ACCENT = RGBColor(37, 99, 235)   # Royal Blue 600
    CYAN_ACCENT = RGBColor(6, 182, 212)   # Cyan 500
    EMERALD_GREEN = RGBColor(16, 185, 129)# Emerald 500
    AMBER_GOLD = RGBColor(245, 158, 11)   # Amber 500
    PURPLE_ACCENT = RGBColor(147, 51, 234)# Purple 600
    WHITE = RGBColor(255, 255, 255)
    LIGHT_GRAY = RGBColor(226, 232, 240) # Slate 200
    MUTED_GRAY = RGBColor(148, 163, 184) # Slate 400

    def add_header(slide, title_text, subtitle_text):
        # Header Box
        header_box = slide.shapes.add_textbox(Inches(0.8), Inches(0.4), Inches(11.7), Inches(0.9))
        tf = header_box.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_top = tf.margin_right = tf.margin_bottom = 0
        
        p = tf.paragraphs[0]
        p.text = title_text
        p.font.size = Pt(22)
        p.font.bold = True
        p.font.color.rgb = WHITE
        
        p2 = tf.add_paragraph()
        p2.text = subtitle_text
        p2.font.size = Pt(12)
        p2.font.color.rgb = CYAN_ACCENT

    # =========================================================================
    # SLIDE 1: TITLE SLIDE
    # =========================================================================
    slide1 = prs.slides.add_slide(blank_layout)
    bg1 = slide1.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(13.333), Inches(7.5))
    bg1.fill.solid()
    bg1.fill.fore_color.rgb = NAVY_DARK
    bg1.line.color.rgb = NAVY_DARK

    title_box = slide1.shapes.add_textbox(Inches(1.0), Inches(2.0), Inches(11.3), Inches(3.5))
    tf1 = title_box.text_frame
    tf1.word_wrap = True
    
    p = tf1.paragraphs[0]
    p.text = "SCBAM Tokenized Mutual Fund (tMMF)"
    p.font.size = Pt(36)
    p.font.bold = True
    p.font.color.rgb = WHITE

    p = tf1.add_paragraph()
    p.text = "Smart Contract Architecture & Core Components"
    p.font.size = Pt(22)
    p.font.bold = True
    p.font.color.rgb = CYAN_ACCENT

    p = tf1.add_paragraph()
    p.text = "\nMulti-Broker Corridor Gateway • Constant NAV Push Yield • ERC-7540 Asynchronous Settlement"
    p.font.size = Pt(14)
    p.font.color.rgb = LIGHT_GRAY

    # Author / Badge Box
    badge = slide1.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(1.0), Inches(5.5), Inches(5.0), Inches(0.8))
    badge.fill.solid()
    badge.fill.fore_color.rgb = NAVY_CARD
    badge.line.color.rgb = BLUE_ACCENT
    btf = badge.text_frame
    p = btf.paragraphs[0]
    p.text = "Target: Hyperledger Besu (Private EVM Network)\nTokenX Contracts v1.0.4 • Solidity 0.8.25"
    p.font.size = Pt(11)
    p.font.color.rgb = MUTED_GRAY

    # =========================================================================
    # SLIDE 2: CORE COMPONENTS & BOX DIAGRAM
    # =========================================================================
    slide2 = prs.slides.add_slide(blank_layout)
    bg2 = slide2.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(13.333), Inches(7.5))
    bg2.fill.solid()
    bg2.fill.fore_color.rgb = NAVY_DARK
    bg2.line.color.rgb = NAVY_DARK
    add_header(slide2, "1. Core Smart Contract Components (Box Architecture)", "4 Decoupled Components Providing KYC Gating, Token Transfers, Compliance, and Vault Orchestration")

    # Contract 1: AllowlistRegistryProxyV2.sol
    box1 = slide2.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(1.5), Inches(2.7), Inches(5.2))
    box1.fill.solid()
    box1.fill.fore_color.rgb = NAVY_CARD
    box1.line.color.rgb = BLUE_ACCENT
    box1.line.width = Pt(2)
    tf = box1.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = "🏛️ Proxy Gateway (v2)\nAllowlistRegistryProxyV2.sol"
    p.font.size = Pt(13)
    p.font.bold = True
    p.font.color.rgb = CYAN_ACCENT
    
    p = tf.add_paragraph()
    p.text = "\n• Aggregates Broker Registries:\n  - InnovestX AllowlistRegistry.sol\n  - Dime AllowlistRegistry.sol\n• Pairwise Corridor Matrix (setCorridor)\n• Direct walletBroker & isAllowTransfer\n• Global Regulatory Blacklist\n• 100% v1 Allowlist Compatible\n\nClearinghouse: Token X"
    p.font.size = Pt(10)
    p.font.color.rgb = LIGHT_GRAY

    # Contract 2: InvestmentTokenM.sol
    box2 = slide2.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(3.8), Inches(1.5), Inches(2.7), Inches(5.2))
    box2.fill.solid()
    box2.fill.fore_color.rgb = NAVY_CARD
    box2.line.color.rgb = PURPLE_ACCENT
    box2.line.width = Pt(2)
    tf = box2.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = "🪙 Main Token (tMMF)\nInvestmentTokenM.sol"
    p.font.size = Pt(13)
    p.font.bold = True
    p.font.color.rgb = PURPLE_ACCENT
    
    p = tf.add_paragraph()
    p.text = "\n• Standard ERC-20 Token\n• Symbol: tMMF (18 Decimals)\n• Pausable, Mintable, Burnable\n• Allowlist Integration via Gateway\n• Uniswap v4-style Transfer Hooks\n  (via ERC20Hooks Extension)\n• Dispatches before/after callbacks\n\nOwner: SCBAM Treasury"
    p.font.size = Pt(10)
    p.font.color.rgb = LIGHT_GRAY

    # Contract 3: FundComplianceHook.sol
    box3 = slide2.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(6.8), Inches(1.5), Inches(2.7), Inches(5.2))
    box3.fill.solid()
    box3.fill.fore_color.rgb = NAVY_CARD
    box3.line.color.rgb = EMERALD_GREEN
    box3.line.width = Pt(2)
    tf = box3.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = "🛡️ Regulatory Hook\nFundComplianceHook.sol"
    p.font.size = Pt(13)
    p.font.bold = True
    p.font.color.rgb = EMERALD_GREEN
    
    p = tf.add_paragraph()
    p.text = "\n• Uniswap v4-style ITransferHook\n• beforeTokenTransfer(caller, from, to, amt):\n  - Asserts Corridors & Min 10 Limit\n• afterTokenTransfer:\n  - Auto-syncs P2P Movements with\n    FundController Ledgers\n• Stateless Plug-and-Play Upgrades\n  (Zero State Migration via setTransferHook)\n\nOwner: Token X"
    p.font.size = Pt(10)
    p.font.color.rgb = LIGHT_GRAY

    # Contract 4: FundController.sol
    box4 = slide2.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(9.8), Inches(1.5), Inches(2.7), Inches(5.2))
    box4.fill.solid()
    box4.fill.fore_color.rgb = NAVY_CARD
    box4.line.color.rgb = AMBER_GOLD
    box4.line.width = Pt(2)
    tf = box4.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = "⚙️ Fund Orchestrator\nFundController.sol"
    p.font.size = Pt(13)
    p.font.bold = True
    p.font.color.rgb = AMBER_GOLD
    
    p = tf.add_paragraph()
    p.text = "\n• NAV Push Yield Distribution (1e10)\n• Per-Broker Active Share Ledgers\n  (totalSharesByBroker)\n• Isolated Broker Reserve Quotas\n• Inter-Broker Reserve Rebalancing\n• ERC-7540 Asynchronous Redemptions:\n  - Day T: Lock Shares in Vault\n  - Day T+1: Permanent Burn\n\nAdmin: SCBAM Treasury"
    p.font.size = Pt(10)
    p.font.color.rgb = LIGHT_GRAY

    # =========================================================================
    # SLIDE 3: ROLE & PERMISSION MATRIX
    # =========================================================================
    slide3 = prs.slides.add_slide(blank_layout)
    bg3 = slide3.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(13.333), Inches(7.5))
    bg3.fill.solid()
    bg3.fill.fore_color.rgb = NAVY_DARK
    bg3.line.color.rgb = NAVY_DARK
    add_header(slide3, "2. Institutional Role & Access Control Matrix", "Clear Separation of Powers: Issuer, Tech Clearinghouse & Automation, and KYC Brokers")

    roles = [
        ("🏛️ SCBAM Treasury", "SUPER ADMIN / ISSUER / FUND MGR", [
            "• Owns InvestmentTokenM (Mints Supply)",
            "• FundController DEFAULT_ADMIN_ROLE",
            "• Day T+1 Settlement Burn (settleRedemptions)",
            "• Rebalances & Sweeps Unallocated Reserves",
            "• Cancels & Refunds Rejected Redemptions",
            "• Authorizes Official Fund Daily NAV"
        ], PURPLE_ACCENT),
        ("⚙️ Token X", "CLEARINGHOUSE & AUTOMATED ENGINE", [
            "• Owns & Governs AllowlistRegistryProxyV2",
            "• Opens/Closes Corridors & Global Unlock",
            "• Manages Global Blacklist & Emergency Pause",
            "• Owns FundComplianceHook & Min Holding Rules",
            "• NAV_UPDATER_ROLE: Daily NAV Oracle Bot",
            "• DISTRIBUTOR_ROLE: Batch Yield Push Bot"
        ], CYAN_ACCENT),
        ("🏢 Broker Distributors", "INNOVESTX & DIME DISTRIBUTORS", [
            "• Own & Manage Dedicated AllowlistRegistry.sol",
            "• Independent KYC Onboarding (addAllowlist)",
            "• FundController ALLOTMENT_ROLE",
            "• Allots Subscription Shares to Users",
            "• Initiates Day T Client Redemptions (requestRedeem)",
            "• Manages Isolated Broker Reserve Buffer"
        ], AMBER_GOLD),
    ]

    for i, (title, subtitle, bullets, color) in enumerate(roles):
        rx = Inches(0.8 + i * 4.0)
        rbox = slide3.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, rx, Inches(1.6), Inches(3.75), Inches(5.0))
        rbox.fill.solid()
        rbox.fill.fore_color.rgb = NAVY_CARD
        rbox.line.color.rgb = color
        rbox.line.width = Pt(1.5)
        
        rtf = rbox.text_frame
        rtf.word_wrap = True
        p = rtf.paragraphs[0]
        p.text = title
        p.font.size = Pt(13)
        p.font.bold = True
        p.font.color.rgb = WHITE
        
        p = rtf.add_paragraph()
        p.text = subtitle
        p.font.size = Pt(10)
        p.font.bold = True
        p.font.color.rgb = color
        
        p = rtf.add_paragraph()
        p.text = "\n" + "\n".join(bullets)
        p.font.size = Pt(10)
        p.font.color.rgb = LIGHT_GRAY

    # =========================================================================
    # SLIDE 4: END-TO-END BUSINESS WORKFLOW
    # =========================================================================
    slide4 = prs.slides.add_slide(blank_layout)
    bg4 = slide4.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(13.333), Inches(7.5))
    bg4.fill.solid()
    bg4.fill.fore_color.rgb = NAVY_DARK
    bg4.line.color.rgb = NAVY_DARK
    add_header(slide4, "3. End-to-End Business Lifecycle Workflow", "Step-by-step Execution from Initial Minting to T+1 Settlement and Inter-Broker Rebalancing")

    steps = [
        ("Step 1: Mint & Fund", "SCBAM Mints tMMF tokens to treasury and deposits into FundController isolated reserve pools (brokerReserve[InnovestX]).", BLUE_ACCENT),
        ("Step 2: KYC & Allotment", "InnovestX registers investor wallet and calls allotShares to credit newly subscribed shares to user.", CYAN_ACCENT),
        ("Step 3: P2P & Corridors", "Transfers within same broker are unrestricted. Cross-broker transfers check corridor and auto-sync broker ledgers via hook.", EMERALD_GREEN),
        ("Step 4: Daily NAV Push", "Oracle pushes daily NAV. Controller computes 10-decimal diff rate. Distributor bot batch credits new shares to all holders.", AMBER_GOLD),
        ("Step 5: Day T Redemption", "Investor requests redemption. Tokens are pulled into controller and locked under lockedForRedemption[broker].", PURPLE_ACCENT),
        ("Step 6: Day T+1 Settlement", "After bank fiat cash is wired via BAHTNET, SCBAM Admin permanently burns the locked tokens on-chain.", RGBColor(239, 68, 68)),
    ]

    for i, (stitle, sdesc, scolor) in enumerate(steps):
        sy = Inches(1.5 + i * 0.9)
        # Number badge
        sbadge = slide4.shapes.add_shape(MSO_SHAPE.OVAL, Inches(0.8), sy, Inches(0.6), Inches(0.6))
        sbadge.fill.solid()
        sbadge.fill.fore_color.rgb = scolor
        sbadge.line.color.rgb = scolor
        stf = sbadge.text_frame
        p = stf.paragraphs[0]
        p.text = str(i + 1)
        p.font.size = Pt(14)
        p.font.bold = True
        p.font.color.rgb = WHITE
        p.alignment = PP_ALIGN.CENTER

        # Text Card
        scard = slide4.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(1.6), sy, Inches(10.9), Inches(0.7))
        scard.fill.solid()
        scard.fill.fore_color.rgb = NAVY_CARD
        scard.line.color.rgb = NAVY_CARD
        ctf = scard.text_frame
        ctf.word_wrap = True
        p = ctf.paragraphs[0]
        p.text = f"{stitle}: "
        p.font.size = Pt(11)
        p.font.bold = True
        p.font.color.rgb = scolor
        
        # Add desc
        p2 = p.text = f"{stitle}: {sdesc}"
        p.font.size = Pt(10)
        p.font.color.rgb = LIGHT_GRAY

    # =========================================================================
    # SLIDE 5: MATHEMATICAL MODEL & INVARIANTS
    # =========================================================================
    slide5 = prs.slides.add_slide(blank_layout)
    bg5 = slide5.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(13.333), Inches(7.5))
    bg5.fill.solid()
    bg5.fill.fore_color.rgb = NAVY_DARK
    bg5.line.color.rgb = NAVY_DARK
    add_header(slide5, "4. Mathematical Model & Excel Alignment Proof", "100% Mathematical Fidelity with หลักการ constant nav.xlsx Across 35 Mockup Investors")

    mcards = [
        ("NAV Diff Multiplier (ตัวคูณ)", "10 Decimals (1e10 Scaling)", "diffPercentScaled = (newNav - oldNav) * 1e10 / oldNav\n\nMatches Excel: ROUND((Today_NAV - Yesterday_NAV) / TotalUnits, 10)", CYAN_ACCENT),
        ("Investor Yield (ผลคูณ)", "Protocol-Safe Floor Math", "sharesEarned = (balanceBefore * diffPercentScaled) / 1e10\n\nGuarantees Sum(Yield) <= Total NAV Growth. Never over-distributes.", EMERALD_GREEN),
        ("Units & Decimals", "4 Decimals Display / 18 On-chain", "Token: 18 decimals internally.\nShares: Displayed in 4 decimals (27,000.1234).\nYield: 2 decimal Satangs (954.69 THB).", PURPLE_ACCENT),
        ("Dust Reconciliation (การโปรยเศษ)", "0.022983 THB Leftover Dust", "Unallocated satangs stay in FundController vault.\nOff-chain service executes waterfall drop to top holders via allotSharesBatch.", AMBER_GOLD),
    ]

    for i, (mtitle, msub, mbody, mcolor) in enumerate(mcards):
        row = i // 2
        col = i % 2
        mx = Inches(0.8 + col * 5.95)
        my = Inches(1.6 + row * 2.6)
        
        mbox = slide5.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, mx, my, Inches(5.7), Inches(2.3))
        mbox.fill.solid()
        mbox.fill.fore_color.rgb = NAVY_CARD
        mbox.line.color.rgb = mcolor
        mbox.line.width = Pt(1.5)
        
        mtf = mbox.text_frame
        mtf.word_wrap = True
        p = mtf.paragraphs[0]
        p.text = mtitle
        p.font.size = Pt(13)
        p.font.bold = True
        p.font.color.rgb = WHITE
        
        p = mtf.add_paragraph()
        p.text = msub
        p.font.size = Pt(11)
        p.font.bold = True
        p.font.color.rgb = mcolor
        
        p = mtf.add_paragraph()
        p.text = "\n" + mbody
        p.font.size = Pt(10)
        p.font.color.rgb = LIGHT_GRAY

    # =========================================================================
    # SLIDE 6: SECURITY & PRODUCTION READINESS
    # =========================================================================
    slide6 = prs.slides.add_slide(blank_layout)
    bg6 = slide6.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(13.333), Inches(7.5))
    bg6.fill.solid()
    bg6.fill.fore_color.rgb = NAVY_DARK
    bg6.line.color.rgb = NAVY_DARK
    add_header(slide6, "5. Security Penetration Testing & Test Verification", "100% Defense Rate Across 16 Attack Vectors • 103/103 Passing Hardhat Unit Tests")

    sec_items = [
        ("🛡️ Reentrancy Protection", "All mutating methods protected with ReentrancyGuard and Checks-Effects-Interactions.", EMERALD_GREEN),
        ("🔒 Pairwise Non-Transitivity", "Corridors are strictly non-transitive (A<->B + B<->C does NOT open A<->C).", BLUE_ACCENT),
        ("🌾 Dust Holding Gate", "Transfers blocked if balance falls into dust zone (0 < x < 10 tMMF). Full exit allowed.", PURPLE_ACCENT),
        ("🔁 Idempotency Replay Locks", "Allotments, distributions, and redemptions protected by unique hash keys.", AMBER_GOLD),
        ("🧮 1:1 Invariant Conservation", "totalSupply == totalShares + controllerVaultBalance verified with 0 wei discrepancy.", CYAN_ACCENT),
        ("⚡ 1,000-Wallet Stress Test", "Simulated 1,000 wallets across 3 brokers under high load — 100% accurate.", RGBColor(34, 197, 94)),
    ]

    for i, (stitle, sdesc, scolor) in enumerate(sec_items):
        row = i // 3
        col = i % 3
        sx = Inches(0.8 + col * 3.95)
        sy = Inches(1.6 + row * 2.6)
        
        sbox = slide6.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, sx, sy, Inches(3.75), Inches(2.3))
        sbox.fill.solid()
        sbox.fill.fore_color.rgb = NAVY_CARD
        sbox.line.color.rgb = scolor
        sbox.line.width = Pt(1.5)
        
        stf = sbox.text_frame
        stf.word_wrap = True
        p = stf.paragraphs[0]
        p.text = stitle
        p.font.size = Pt(12)
        p.font.bold = True
        p.font.color.rgb = WHITE
        
        p = stf.add_paragraph()
        p.text = "\n" + sdesc
        p.font.size = Pt(10)
        p.font.color.rgb = LIGHT_GRAY

    # Save presentation
    output_path = "tMMF_Architecture_Presentation.pptx"
    prs.save(output_path)
    print(f"Presentation saved successfully to: {output_path}")

if __name__ == "__main__":
    create_deck()
