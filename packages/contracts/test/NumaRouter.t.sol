// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {NumaRouter} from "../src/NumaRouter.sol";
import {CampaignRegistry} from "../src/CampaignRegistry.sol";
import {INumaRouter} from "../src/interfaces/INumaRouter.sol";
import {ICampaignRegistry} from "../src/interfaces/ICampaignRegistry.sol";
import {MockUSDT} from "./mocks/MockUSDT.sol";

contract NumaRouterTest is Test {
    bytes32 private constant ORDER_TYPEHASH = keccak256(
        "Order(uint256 campaignId,address merchant,address creator,address buyer,uint256 gross,bytes32 orderId,uint256 deadline)"
    );
    bytes32 private constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 private constant ORDER_COMMITMENT_TYPEHASH = keccak256(
        "OrderCommitment(uint256 campaignId,address merchant,address creator,address buyer,uint256 gross,uint96 commissionBps,uint96 feeBps,bytes32 orderId,uint256 deadline)"
    );
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    NumaRouter router;
    CampaignRegistry registry;
    MockUSDT usdt;

    uint256 merchantPk;
    uint256 payoutSignerPk;
    uint256 buyerPk;
    address merchant;
    address payoutSigner;
    address buyer;
    address creator = makeAddr("creator");
    address feeRecipient = makeAddr("feeRecipient");

    uint96 constant COMMISSION_BPS = 1000; // 10%
    uint96 constant FEE_BPS = 50; // 0.5%
    uint256 constant REFUND_WINDOW = 1 days;

    uint256 campaignId;

    function setUp() public {
        vm.warp(1_700_000_000);

        (merchant, merchantPk) = makeAddrAndKey("merchant");
        (payoutSigner, payoutSignerPk) = makeAddrAndKey("payoutSigner");
        (buyer, buyerPk) = makeAddrAndKey("buyer");

        usdt = new MockUSDT();
        registry = new CampaignRegistry();
        router = new NumaRouter(address(usdt), address(registry), feeRecipient, FEE_BPS, REFUND_WINDOW);

        vm.prank(merchant);
        campaignId = registry.createCampaign(payoutSigner, COMMISSION_BPS, uint64(block.timestamp + 30 days));
        vm.prank(merchant);
        registry.approveCreator(campaignId, creator);

        usdt.mint(buyer, 1_000_000e6);
        vm.prank(merchant);
        usdt.approve(address(router), type(uint256).max);
    }

    // ---------- helpers ----------

    function _domainSeparator(string memory name, string memory version, address verifyingContract)
        internal
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                block.chainid,
                verifyingContract
            )
        );
    }

    function _signOrder(INumaRouter.Order memory order, uint256 pk) internal view returns (bytes memory) {
        return _signOrderFor(order, pk, address(router));
    }

    function _signOrderFor(INumaRouter.Order memory order, uint256 pk, address verifyingContract)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                ORDER_TYPEHASH,
                order.campaignId,
                order.merchant,
                order.creator,
                order.buyer,
                order.gross,
                order.orderId,
                order.deadline
            )
        );
        bytes32 domainSeparator = _domainSeparator("NumaRouter", "1", verifyingContract);
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint256 pk
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 structHash = keccak256(
            abi.encode(RECEIVE_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce)
        );
        bytes32 domainSeparator = _domainSeparator("Mock Tether USD", "1", address(usdt));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (v, r, s) = vm.sign(pk, digest);
    }

    function _defaultOrder(uint256 gross, bytes32 orderId) internal view returns (INumaRouter.Order memory) {
        return INumaRouter.Order({
            campaignId: campaignId,
            merchant: merchant,
            creator: creator,
            buyer: buyer,
            gross: gross,
            orderId: orderId,
            deadline: block.timestamp + 1 hours
        });
    }

    /// @dev Mirrors NumaRouter's clawback formula for test expectations. Takes the commission and
    /// refundable base as runtime args so the division isn't folded as a compile-time rational.
    function _expectedClawback(uint256 commission, uint256 refundAmount, uint256 refundableBase)
        internal
        pure
        returns (uint256)
    {
        return (commission * refundAmount) / refundableBase;
    }

    /// @dev Independent (test-side) reimplementation of NumaRouter.computeOrderCommitment, used to
    /// cross-check the contract's own computation rather than relying on it to generate its own
    /// expected values (which would be tautological). Must stay byte-for-byte in sync with
    /// src/NumaRouter.sol's ORDER_COMMITMENT_TYPEHASH and field order.
    function _orderCommitment(
        INumaRouter.Order memory order,
        uint96 commissionBps,
        uint96 feeBps_,
        address verifyingContract
    ) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                ORDER_COMMITMENT_TYPEHASH,
                order.campaignId,
                order.merchant,
                order.creator,
                order.buyer,
                order.gross,
                commissionBps,
                feeBps_,
                order.orderId,
                order.deadline
            )
        );
        bytes32 domainSeparator = _domainSeparator("NumaRouter", "1", verifyingContract);
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function _payOrder(INumaRouter.Order memory order) internal {
        // Uses the default campaign's known COMMISSION_BPS/FEE_BPS directly rather than querying
        // the registry/router here (both would be extra external calls, which would consume
        // vm.expectRevert's "next call" slot ahead of the actual router.payOrder() call in tests
        // that expect an earlier revert). Tests using a different/invalid campaignId never reach
        // the authNonce check anyway (it's validated after the earlier campaign/creator checks),
        // so the nonce's "correctness" relative to COMMISSION_BPS/FEE_BPS doesn't matter for those.
        bytes memory sig = _signOrder(order, payoutSignerPk);
        bytes32 nonce = _orderCommitment(order, COMMISSION_BPS, FEE_BPS, address(router));
        uint256 validAfter = 0;
        uint256 validBefore = order.deadline;
        (uint8 v, bytes32 r, bytes32 s) =
            _signAuthorization(order.buyer, address(router), order.gross, validAfter, validBefore, nonce, buyerPk);
        router.payOrder(order, sig, validAfter, validBefore, nonce, v, r, s);
    }

    // ---------- payOrder ----------

    function test_payOrder_settlesAndSplitsCorrectly() public {
        uint256 gross = 100e6;
        INumaRouter.Order memory order = _defaultOrder(gross, bytes32(uint256(1)));

        uint256 merchantBalBefore = usdt.balanceOf(merchant);
        uint256 feeBalBefore = usdt.balanceOf(feeRecipient);

        vm.expectEmit(true, true, true, true);
        emit INumaRouter.OrderSettled(order.orderId, campaignId, merchant, creator, buyer, gross, 89.5e6, 10e6, 0.5e6);
        _payOrder(order);

        assertEq(usdt.balanceOf(merchant) - merchantBalBefore, 89.5e6);
        assertEq(usdt.balanceOf(feeRecipient) - feeBalBefore, 0.5e6);
        assertEq(usdt.balanceOf(address(router)), 10e6);

        INumaRouter.Settlement memory s = router.getSettlement(order.orderId);
        assertEq(s.heldCommission, 10e6);
        assertEq(s.commission, 10e6);
        assertEq(s.fee, 0.5e6);
        assertFalse(s.released);
    }

    function test_payOrder_revertsOnReplay() public {
        INumaRouter.Order memory order = _defaultOrder(100e6, bytes32(uint256(1)));
        _payOrder(order);

        vm.expectRevert("NumaRouter: order already settled");
        _payOrder(order);
    }

    function test_payOrder_revertsOnExpiredOrder() public {
        INumaRouter.Order memory order = _defaultOrder(100e6, bytes32(uint256(1)));
        vm.warp(order.deadline + 1);
        vm.expectRevert("NumaRouter: order expired");
        _payOrder(order);
    }

    function test_payOrder_revertsWhenBuyerIsMerchant() public {
        INumaRouter.Order memory order = _defaultOrder(100e6, bytes32(uint256(1)));
        order.buyer = merchant;
        vm.expectRevert("NumaRouter: buyer is merchant");
        _payOrder(order);
    }

    function test_payOrder_revertsWhenBuyerIsCreator() public {
        INumaRouter.Order memory order = _defaultOrder(100e6, bytes32(uint256(1)));
        order.buyer = creator;
        vm.expectRevert("NumaRouter: buyer is creator");
        _payOrder(order);
    }

    function test_payOrder_revertsWhenCreatorNotApproved() public {
        address unapprovedCreator = makeAddr("unapproved");
        INumaRouter.Order memory order = _defaultOrder(100e6, bytes32(uint256(1)));
        order.creator = unapprovedCreator;
        vm.expectRevert("NumaRouter: creator not approved");
        _payOrder(order);
    }

    function test_payOrder_revertsWhenCampaignPaused() public {
        vm.prank(merchant);
        registry.pause(campaignId, true);

        INumaRouter.Order memory order = _defaultOrder(100e6, bytes32(uint256(1)));
        vm.expectRevert("NumaRouter: campaign not settleable");
        _payOrder(order);
    }

    function test_payOrder_revertsWhenCampaignExpired() public {
        ICampaignRegistry.Campaign memory c = registry.getCampaign(campaignId);
        vm.warp(c.endsAt + 1);

        INumaRouter.Order memory order = _defaultOrder(100e6, bytes32(uint256(1)));
        order.deadline = block.timestamp + 1 hours;
        vm.expectRevert("NumaRouter: campaign not settleable");
        _payOrder(order);
    }

    function test_payOrder_revertsOnInvalidMerchantSignature() public {
        INumaRouter.Order memory order = _defaultOrder(100e6, bytes32(uint256(1)));
        bytes memory wrongSig = _signOrder(order, buyerPk); // signed by the wrong key
        bytes32 nonce = _orderCommitment(order, COMMISSION_BPS, FEE_BPS, address(router));
        (uint8 v, bytes32 r, bytes32 s) =
            _signAuthorization(order.buyer, address(router), order.gross, 0, order.deadline, nonce, buyerPk);
        vm.expectRevert("NumaRouter: invalid merchant signature");
        router.payOrder(order, wrongSig, 0, order.deadline, nonce, v, r, s);
    }

    function test_payOrder_revertsOnMerchantMismatch() public {
        INumaRouter.Order memory order = _defaultOrder(100e6, bytes32(uint256(1)));
        order.merchant = makeAddr("someoneElse");
        vm.expectRevert("NumaRouter: merchant mismatch");
        _payOrder(order);
    }

    function test_payOrder_revertsOnUnknownCampaign() public {
        INumaRouter.Order memory order = _defaultOrder(100e6, bytes32(uint256(1)));
        order.campaignId = 999;
        vm.expectRevert("NumaRouter: unknown campaign");
        _payOrder(order);
    }

    function test_payOrder_revertsOnInsufficientAuthorization() public {
        uint256 gross = 100e6;
        INumaRouter.Order memory order = _defaultOrder(gross, bytes32(uint256(1)));
        bytes memory sig = _signOrder(order, payoutSignerPk);
        // Nonce matches the order commitment (so the new authNonce check passes), but the buyer's
        // authorization signature covers a different value than order.gross, which the MockUSDT
        // rejects at signature-recovery time — isolating the token-level value check from the
        // router-level authNonce check added for the OrderCommitment design.
        bytes32 nonce = _orderCommitment(order, COMMISSION_BPS, FEE_BPS, address(router));
        (uint8 v, bytes32 r, bytes32 s) =
            _signAuthorization(order.buyer, address(router), gross - 1, 0, order.deadline, nonce, buyerPk);
        vm.expectRevert("MockUSDT: invalid authorization signature");
        router.payOrder(order, sig, 0, order.deadline, nonce, v, r, s);
    }

    function testFuzz_payOrder_splitInvariant(uint256 gross, uint96 commissionBps, uint96 feeBps) public {
        gross = bound(gross, 1, 1_000_000e6);
        commissionBps = uint96(bound(commissionBps, 0, 5000));
        feeBps = uint96(bound(feeBps, 0, 100));

        NumaRouter r2 = new NumaRouter(address(usdt), address(registry), feeRecipient, feeBps, REFUND_WINDOW);
        vm.prank(merchant);
        uint256 cid = registry.createCampaign(payoutSigner, commissionBps, uint64(block.timestamp + 30 days));
        vm.prank(merchant);
        registry.approveCreator(cid, creator);
        vm.prank(merchant);
        usdt.approve(address(r2), type(uint256).max);

        INumaRouter.Order memory order = INumaRouter.Order({
            campaignId: cid,
            merchant: merchant,
            creator: creator,
            buyer: buyer,
            gross: gross,
            orderId: bytes32(uint256(42)),
            deadline: block.timestamp + 1 hours
        });
        bytes memory sig = _signOrderFor(order, payoutSignerPk, address(r2));
        bytes32 nonce = _orderCommitment(order, commissionBps, feeBps, address(r2));
        (uint8 v, bytes32 rr, bytes32 ss) = _signAuthForRouter(order, r2, nonce);

        uint256 merchantBefore = usdt.balanceOf(merchant);
        uint256 feeBefore = usdt.balanceOf(feeRecipient);

        r2.payOrder(order, sig, 0, order.deadline, nonce, v, rr, ss);

        uint256 commission = (gross * commissionBps) / 10_000;
        uint256 fee = (gross * feeBps) / 10_000;
        uint256 merchantNet = gross - commission - fee;

        assertEq(usdt.balanceOf(merchant) - merchantBefore, merchantNet);
        assertEq(usdt.balanceOf(feeRecipient) - feeBefore, fee);
        assertEq(usdt.balanceOf(address(r2)), commission);
        assertEq(merchantNet + commission + fee, gross);
    }

    function _signAuthForRouter(INumaRouter.Order memory order, NumaRouter r2, bytes32 nonce)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                RECEIVE_WITH_AUTHORIZATION_TYPEHASH, order.buyer, address(r2), order.gross, 0, order.deadline, nonce
            )
        );
        bytes32 domainSeparator = _domainSeparator("Mock Tether USD", "1", address(usdt));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (v, r, s) = vm.sign(buyerPk, digest);
    }

    // ---------- constructor validation (pre-deployment audit fixes) ----------

    function test_constructor_revertsOnEOAUsdt() public {
        address eoa = makeAddr("notAContract");
        vm.expectRevert("NumaRouter: usdt is not a contract");
        new NumaRouter(eoa, address(registry), feeRecipient, FEE_BPS, REFUND_WINDOW);
    }

    function test_constructor_revertsOnEOARegistry() public {
        address eoa = makeAddr("notAContract");
        vm.expectRevert("NumaRouter: registry is not a contract");
        new NumaRouter(address(usdt), eoa, feeRecipient, FEE_BPS, REFUND_WINDOW);
    }

    function test_constructor_revertsOnRefundWindowTooLong() public {
        uint256 tooLong = 365 days + 1;
        vm.expectRevert("NumaRouter: refund window too long");
        new NumaRouter(address(usdt), address(registry), feeRecipient, FEE_BPS, tooLong);
    }

    function test_constructor_allowsExactlyMaxRefundWindow() public {
        NumaRouter r = new NumaRouter(address(usdt), address(registry), feeRecipient, FEE_BPS, 365 days);
        assertEq(r.refundWindow(), 365 days);
    }

    function test_constructor_allowsZeroRefundWindow() public {
        // A refund window of 0 is a deliberate, documented product choice (e.g. a shortened demo
        // window per initial-prompt.md) — the constructor only caps the upper bound, not a minimum.
        NumaRouter r = new NumaRouter(address(usdt), address(registry), feeRecipient, FEE_BPS, 0);
        assertEq(r.refundWindow(), 0);
    }

    // ---------- OrderCommitment / authNonce binding ----------

    function _orderDigest(INumaRouter.Order memory order, address verifyingContract) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                ORDER_TYPEHASH,
                order.campaignId,
                order.merchant,
                order.creator,
                order.buyer,
                order.gross,
                order.orderId,
                order.deadline
            )
        );
        bytes32 domainSeparator = _domainSeparator("NumaRouter", "1", verifyingContract);
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function test_payOrder_revertsWhenAuthNonceDoesNotMatchCommitment() public {
        INumaRouter.Order memory order = _defaultOrder(100e6, bytes32(uint256(1)));
        bytes memory sig = _signOrder(order, payoutSignerPk);
        bytes32 wrongNonce = order.orderId; // arbitrary bytes32, not the real commitment
        (uint8 v, bytes32 r, bytes32 s) =
            _signAuthorization(order.buyer, address(router), order.gross, 0, order.deadline, wrongNonce, buyerPk);
        vm.expectRevert("NumaRouter: authNonce does not match order commitment");
        router.payOrder(order, sig, 0, order.deadline, wrongNonce, v, r, s);
    }

    function test_payOrder_rejectsCreatorSubstitution() public {
        address creatorB = makeAddr("creatorB");
        vm.prank(merchant);
        registry.approveCreator(campaignId, creatorB);

        INumaRouter.Order memory orderA = _defaultOrder(100e6, bytes32(uint256(1)));
        bytes32 nonceForA = _orderCommitment(orderA, COMMISSION_BPS, FEE_BPS, address(router));
        (uint8 v, bytes32 r, bytes32 s) =
            _signAuthorization(buyer, address(router), 100e6, 0, orderA.deadline, nonceForA, buyerPk);

        // Attacker crafts a different, independently merchant-signed order for a different
        // (also-approved) creator, same gross, and tries to settle it using the buyer's
        // authorization that was actually bound to orderA.
        INumaRouter.Order memory orderB = orderA;
        orderB.creator = creatorB;
        orderB.orderId = bytes32(uint256(2));
        bytes memory sigB = _signOrder(orderB, payoutSignerPk);

        vm.expectRevert("NumaRouter: authNonce does not match order commitment");
        router.payOrder(orderB, sigB, 0, orderA.deadline, nonceForA, v, r, s);
    }

    function test_payOrder_rejectsCampaignAndMerchantSubstitution() public {
        // The mentor-flagged core attack: an attacker (permissionlessly) creates their own
        // campaign/merchant identity and an accomplice creator, then tries to redirect a
        // buyer's authorization (signed for a legitimate order) to their own order instead.
        address attacker = makeAddr("attacker");
        (address attackerSigner, uint256 attackerSignerPk) = makeAddrAndKey("attackerSigner");
        address accomplice = makeAddr("accomplice");

        vm.prank(attacker);
        uint256 attackerCampaignId = registry.createCampaign(attackerSigner, 5000, uint64(block.timestamp + 30 days));
        vm.prank(attacker);
        registry.approveCreator(attackerCampaignId, accomplice);

        INumaRouter.Order memory legit = _defaultOrder(100e6, bytes32(uint256(1)));
        bytes32 legitNonce = _orderCommitment(legit, COMMISSION_BPS, FEE_BPS, address(router));
        (uint8 v, bytes32 r, bytes32 s) =
            _signAuthorization(buyer, address(router), 100e6, 0, legit.deadline, legitNonce, buyerPk);

        INumaRouter.Order memory malicious = INumaRouter.Order({
            campaignId: attackerCampaignId,
            merchant: attacker,
            creator: accomplice,
            buyer: buyer,
            gross: 100e6,
            orderId: bytes32(uint256(999)),
            deadline: legit.deadline
        });
        bytes memory maliciousSig = _signOrder(malicious, attackerSignerPk);

        vm.expectRevert("NumaRouter: authNonce does not match order commitment");
        router.payOrder(malicious, maliciousSig, 0, legit.deadline, legitNonce, v, r, s);
    }

    function test_payOrder_rejectsOrderIdSubstitution() public {
        INumaRouter.Order memory orderA = _defaultOrder(100e6, bytes32(uint256(1)));
        bytes32 nonceForA = _orderCommitment(orderA, COMMISSION_BPS, FEE_BPS, address(router));
        (uint8 v, bytes32 r, bytes32 s) =
            _signAuthorization(buyer, address(router), 100e6, 0, orderA.deadline, nonceForA, buyerPk);

        INumaRouter.Order memory orderB = orderA;
        orderB.orderId = bytes32(uint256(2));
        bytes memory sigB = _signOrder(orderB, payoutSignerPk);

        vm.expectRevert("NumaRouter: authNonce does not match order commitment");
        router.payOrder(orderB, sigB, 0, orderA.deadline, nonceForA, v, r, s);
    }

    function test_computeOrderCommitment_sensitiveToCommissionBps() public view {
        INumaRouter.Order memory order = _defaultOrder(100e6, bytes32(uint256(1)));
        bytes32 c1 = router.computeOrderCommitment(order, 1000, FEE_BPS);
        bytes32 c2 = router.computeOrderCommitment(order, 2000, FEE_BPS);
        assertTrue(c1 != c2);
    }

    function test_computeOrderCommitment_sensitiveToFeeBps() public view {
        INumaRouter.Order memory order = _defaultOrder(100e6, bytes32(uint256(1)));
        bytes32 c1 = router.computeOrderCommitment(order, COMMISSION_BPS, 50);
        bytes32 c2 = router.computeOrderCommitment(order, COMMISSION_BPS, 60);
        assertTrue(c1 != c2);
    }

    function testFuzz_orderCommitmentNeverCollidesWithOrderDigest(uint256 gross, uint96 commissionBps, uint96 feeBps_)
        public
        view
    {
        gross = bound(gross, 1, 1_000_000e6);
        INumaRouter.Order memory order = _defaultOrder(gross, bytes32(uint256(1)));
        bytes32 commitment = router.computeOrderCommitment(order, commissionBps, feeBps_);
        bytes32 orderDigest = _orderDigest(order, address(router));
        assertTrue(commitment != orderDigest);
    }

    /// @notice Fixed cross-language test vector (see the security design validation report).
    /// TypeScript must independently compute the identical digest from the identical inputs.
    /// The router is deployed at a fixed address (not wherever this test's CREATE nonce would
    /// normally place it) because the EIP-712 domain separator depends on the verifying contract
    /// address, and the test vector's expected digest was computed against this exact address.
    function test_fixedVector_orderCommitmentMatchesCrossLanguageSpec() public {
        vm.chainId(1874); // the test vector assumes Whitechain Sepolia's chain ID

        address fixedRouter = 0x4444444444444444444444444444444444444444;
        deployCodeTo(
            "NumaRouter.sol:NumaRouter",
            abi.encode(address(usdt), address(registry), feeRecipient, FEE_BPS, REFUND_WINDOW),
            fixedRouter
        );
        NumaRouter vectorRouter = NumaRouter(fixedRouter);

        INumaRouter.Order memory order = INumaRouter.Order({
            campaignId: 7,
            merchant: 0x1111111111111111111111111111111111111111,
            creator: 0x2222222222222222222222222222222222222222,
            buyer: 0x3333333333333333333333333333333333333333,
            gross: 100_000_000,
            orderId: bytes32(uint256(0x2a)),
            deadline: 2_000_000_000
        });

        bytes32 commitment = vectorRouter.computeOrderCommitment(order, 1000, 50);
        assertEq(commitment, 0x47a0866ddbb8f61bab6637439ff2adec7b94c8afb8dc57cef34220918142f1cb);
    }

    // ---------- refund ----------

    function test_refund_partialCalculatesClawbackAndPull() public {
        uint256 gross = 100e6;
        INumaRouter.Order memory order = _defaultOrder(gross, bytes32(uint256(1)));
        _payOrder(order);

        // refundableBase = gross - fee = 99_500_000; clawback = commission * refundAmount / refundableBase
        // = 10e6 * 50e6 / 99_500_000 = 5,025,125 (floor); merchantPull = 50e6 - 5,025,125 = 44,974,875.
        uint256 expectedClawback = _expectedClawback(10e6, 50e6, 99_500_000);
        uint256 expectedMerchantPull = 50e6 - expectedClawback;

        uint256 buyerBalBefore = usdt.balanceOf(buyer);
        uint256 merchantBalBefore = usdt.balanceOf(merchant);

        vm.prank(merchant);
        vm.expectEmit(true, true, true, true);
        emit INumaRouter.OrderRefunded(order.orderId, 50e6, expectedClawback, expectedMerchantPull);
        router.refund(order.orderId, 50e6);

        assertEq(usdt.balanceOf(buyer) - buyerBalBefore, 50e6);
        assertEq(merchantBalBefore - usdt.balanceOf(merchant), expectedMerchantPull);

        INumaRouter.Settlement memory s = router.getSettlement(order.orderId);
        assertEq(s.heldCommission, 10e6 - expectedClawback);
        assertEq(s.refundedGross, 50e6);
    }

    function test_refund_maxRefundableClawsBackEntireCommission() public {
        uint256 gross = 100e6;
        INumaRouter.Order memory order = _defaultOrder(gross, bytes32(uint256(1)));
        _payOrder(order);

        // Max refundable = gross - fee (the protocol fee is never refunded).
        uint256 maxRefundable = gross - 0.5e6;
        vm.prank(merchant);
        router.refund(order.orderId, maxRefundable);

        INumaRouter.Settlement memory s = router.getSettlement(order.orderId);
        assertEq(s.heldCommission, 0);
        assertEq(s.refundedGross, maxRefundable);
    }

    function test_refund_revertsWhenExceedingGrossMinusFee() public {
        uint256 gross = 100e6;
        INumaRouter.Order memory order = _defaultOrder(gross, bytes32(uint256(1)));
        _payOrder(order);

        vm.prank(merchant);
        vm.expectRevert("NumaRouter: refund exceeds refundable amount");
        router.refund(order.orderId, gross); // full gross includes the non-refundable fee
    }

    function test_refund_revertsForNonMerchant() public {
        INumaRouter.Order memory order = _defaultOrder(100e6, bytes32(uint256(1)));
        _payOrder(order);

        vm.expectRevert("NumaRouter: not merchant");
        router.refund(order.orderId, 50e6);
    }

    function test_refund_revertsWhenExceedsGross() public {
        INumaRouter.Order memory order = _defaultOrder(100e6, bytes32(uint256(1)));
        _payOrder(order);

        vm.prank(merchant);
        vm.expectRevert("NumaRouter: refund exceeds refundable amount");
        router.refund(order.orderId, 100e6 + 1);
    }

    function test_refund_revertsAfterRelease() public {
        INumaRouter.Order memory order = _defaultOrder(100e6, bytes32(uint256(1)));
        _payOrder(order);

        vm.warp(block.timestamp + REFUND_WINDOW + 1);
        router.release(order.orderId);

        vm.prank(merchant);
        vm.expectRevert("NumaRouter: already released");
        router.refund(order.orderId, 10e6);
    }

    function test_refund_revertsWithoutMerchantAllowance() public {
        INumaRouter.Order memory order = _defaultOrder(100e6, bytes32(uint256(1)));
        _payOrder(order);

        vm.prank(merchant);
        usdt.approve(address(router), 0);

        vm.prank(merchant);
        vm.expectRevert();
        router.refund(order.orderId, 50e6);
    }

    function test_refund_twoPartialRefundsAccumulate() public {
        INumaRouter.Order memory order = _defaultOrder(100e6, bytes32(uint256(1)));
        _payOrder(order);

        vm.startPrank(merchant);
        router.refund(order.orderId, 30e6);
        router.refund(order.orderId, 20e6);
        vm.stopPrank();

        INumaRouter.Settlement memory s = router.getSettlement(order.orderId);
        assertEq(s.refundedGross, 50e6);
        // Two sequential proportional clawbacks over refundableBase = 99_500_000.
        uint256 clawback1 = _expectedClawback(10e6, 30e6, 99_500_000);
        uint256 clawback2 = _expectedClawback(10e6, 20e6, 99_500_000);
        assertEq(s.heldCommission, 10e6 - clawback1 - clawback2);
    }

    // ---------- release ----------

    function test_release_paysCreatorAfterWindow() public {
        INumaRouter.Order memory order = _defaultOrder(100e6, bytes32(uint256(1)));
        _payOrder(order);

        vm.warp(block.timestamp + REFUND_WINDOW + 1);

        uint256 creatorBalBefore = usdt.balanceOf(creator);
        vm.expectEmit(true, true, true, true);
        emit INumaRouter.CommissionReleased(order.orderId, creator, 10e6);
        router.release(order.orderId);

        assertEq(usdt.balanceOf(creator) - creatorBalBefore, 10e6);
        assertTrue(router.getSettlement(order.orderId).released);
    }

    function test_release_revertsBeforeWindow() public {
        INumaRouter.Order memory order = _defaultOrder(100e6, bytes32(uint256(1)));
        _payOrder(order);

        vm.expectRevert("NumaRouter: refund window open");
        router.release(order.orderId);
    }

    function test_release_revertsOnDoubleRelease() public {
        INumaRouter.Order memory order = _defaultOrder(100e6, bytes32(uint256(1)));
        _payOrder(order);

        vm.warp(block.timestamp + REFUND_WINDOW + 1);
        router.release(order.orderId);

        vm.expectRevert("NumaRouter: already released");
        router.release(order.orderId);
    }

    function test_release_callableByAnyone() public {
        INumaRouter.Order memory order = _defaultOrder(100e6, bytes32(uint256(1)));
        _payOrder(order);

        vm.warp(block.timestamp + REFUND_WINDOW + 1);
        vm.prank(makeAddr("rando"));
        router.release(order.orderId);

        assertTrue(router.getSettlement(order.orderId).released);
    }

    function test_release_afterPartialRefundPaysRemainder() public {
        INumaRouter.Order memory order = _defaultOrder(100e6, bytes32(uint256(1)));
        _payOrder(order);

        vm.prank(merchant);
        router.refund(order.orderId, 50e6);
        uint256 expectedClawback = _expectedClawback(10e6, 50e6, 99_500_000);

        vm.warp(block.timestamp + REFUND_WINDOW + 1);
        uint256 creatorBalBefore = usdt.balanceOf(creator);
        router.release(order.orderId);

        assertEq(usdt.balanceOf(creator) - creatorBalBefore, 10e6 - expectedClawback);
    }
}
