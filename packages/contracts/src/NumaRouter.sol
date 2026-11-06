// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {INumaRouter} from "./interfaces/INumaRouter.sol";
import {ICampaignRegistry} from "./interfaces/ICampaignRegistry.sol";
import {IERC3009} from "./interfaces/IERC3009.sol";

/// @notice Settles gasless USDT orders: pulls a buyer's EIP-3009 authorization, validates the
/// merchant's EIP-712 order signature and the campaign's creator approval, then splits the
/// payment — merchant net paid immediately, creator commission held through a refund window,
/// protocol fee collected immediately. See docs/DECISIONS/0001-refund-funding-model.md for the
/// refund funding model (merchant-approved USDT pull, not escrow).
contract NumaRouter is INumaRouter, EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 private constant ORDER_TYPEHASH = keccak256(
        "Order(uint256 campaignId,address merchant,address creator,address buyer,uint256 gross,bytes32 orderId,uint256 deadline)"
    );

    uint96 public constant MAX_FEE_BPS = 100; // 1%

    IERC20 public immutable usdt;
    ICampaignRegistry public immutable registry;
    address public immutable feeRecipient;
    uint96 public immutable feeBps;
    uint256 public immutable refundWindow;

    mapping(bytes32 => Settlement) private _settlements;

    constructor(
        address usdt_,
        address registry_,
        address feeRecipient_,
        uint96 feeBps_,
        uint256 refundWindow_
    ) EIP712("NumaRouter", "1") {
        require(usdt_ != address(0), "NumaRouter: zero usdt");
        require(registry_ != address(0), "NumaRouter: zero registry");
        require(feeRecipient_ != address(0), "NumaRouter: zero feeRecipient");
        require(feeBps_ <= MAX_FEE_BPS, "NumaRouter: fee too high");

        usdt = IERC20(usdt_);
        registry = ICampaignRegistry(registry_);
        feeRecipient = feeRecipient_;
        feeBps = feeBps_;
        refundWindow = refundWindow_;
    }

    function payOrder(
        Order calldata order,
        bytes calldata merchantSignature,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 authNonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        require(block.timestamp <= order.deadline, "NumaRouter: order expired");
        require(!_settlements[order.orderId].exists, "NumaRouter: order already settled");
        require(order.buyer != order.merchant, "NumaRouter: buyer is merchant");
        require(order.buyer != order.creator, "NumaRouter: buyer is creator");
        require(order.gross > 0, "NumaRouter: zero gross");

        ICampaignRegistry.Campaign memory campaign = registry.getCampaign(order.campaignId);
        require(campaign.exists, "NumaRouter: unknown campaign");
        require(registry.isSettleable(order.campaignId), "NumaRouter: campaign not settleable");
        require(order.merchant == campaign.merchant, "NumaRouter: merchant mismatch");
        require(registry.isCreatorApproved(order.campaignId, order.creator), "NumaRouter: creator not approved");

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
        address signer = ECDSA.recover(_hashTypedDataV4(structHash), merchantSignature);
        require(signer == campaign.payoutSigner, "NumaRouter: invalid merchant signature");

        // Pull the buyer's authorized USDT into this contract. EIP-3009 requires msg.sender == to,
        // so this contract must be both the caller and the recipient.
        IERC3009(address(usdt)).receiveWithAuthorization(
            order.buyer, address(this), order.gross, validAfter, validBefore, authNonce, v, r, s
        );

        uint256 commission = (order.gross * campaign.commissionBps) / 10_000;
        uint256 fee = (order.gross * feeBps) / 10_000;
        uint256 merchantNet = order.gross - commission - fee;

        _settlements[order.orderId] = Settlement({
            merchant: order.merchant,
            creator: order.creator,
            buyer: order.buyer,
            gross: order.gross,
            commission: commission,
            fee: fee,
            heldCommission: commission,
            refundedGross: 0,
            paidAt: block.timestamp,
            released: false,
            exists: true
        });

        if (merchantNet > 0) usdt.safeTransfer(order.merchant, merchantNet);
        if (fee > 0) usdt.safeTransfer(feeRecipient, fee);

        emit OrderSettled(
            order.orderId, order.campaignId, order.merchant, order.creator, order.buyer, order.gross, merchantNet, commission, fee
        );
    }

    /// @notice Refund part or all of a settled order. Callable only by the order's merchant,
    /// only before `release`. See docs/DECISIONS/0001-refund-funding-model.md: the still-held
    /// commission is clawed back proportionally first, the merchant's USDT allowance funds the
    /// remainder. The protocol fee is never refunded.
    function refund(bytes32 orderId, uint256 refundAmount) external nonReentrant {
        Settlement storage settlement = _settlements[orderId];
        require(settlement.exists, "NumaRouter: unknown order");
        require(msg.sender == settlement.merchant, "NumaRouter: not merchant");
        require(!settlement.released, "NumaRouter: already released");
        require(refundAmount > 0, "NumaRouter: zero refund");
        // The protocol fee is never refunded (see docs/DECISIONS/0001-refund-funding-model.md),
        // so the maximum recoverable amount across all refunds for this order is the refundable
        // base: gross - fee (= merchantNet + commission).
        uint256 refundableBase = settlement.gross - settlement.fee;
        require(
            settlement.refundedGross + refundAmount <= refundableBase, "NumaRouter: refund exceeds refundable amount"
        );

        // Clawback is proportional to the refundable base (not gross), so a refund of the full
        // refundable base claws back exactly the full held commission and pulls exactly
        // merchantNet from the merchant — never more than the merchant actually received.
        uint256 commissionClawback = (settlement.commission * refundAmount) / refundableBase;
        if (commissionClawback > settlement.heldCommission) {
            commissionClawback = settlement.heldCommission;
        }
        uint256 merchantPull = refundAmount - commissionClawback;

        settlement.heldCommission -= commissionClawback;
        settlement.refundedGross += refundAmount;

        if (commissionClawback > 0) usdt.safeTransfer(settlement.buyer, commissionClawback);
        if (merchantPull > 0) {
            usdt.safeTransferFrom(settlement.merchant, settlement.buyer, merchantPull);
        }

        emit OrderRefunded(orderId, refundAmount, commissionClawback, merchantPull);
    }

    /// @notice Release the remaining held commission to the creator once the refund window has
    /// elapsed. Callable by anyone; idempotent (reverts on a second call).
    function release(bytes32 orderId) external nonReentrant {
        Settlement storage settlement = _settlements[orderId];
        require(settlement.exists, "NumaRouter: unknown order");
        require(!settlement.released, "NumaRouter: already released");
        require(block.timestamp >= settlement.paidAt + refundWindow, "NumaRouter: refund window open");

        uint256 amount = settlement.heldCommission;
        settlement.heldCommission = 0;
        settlement.released = true;

        if (amount > 0) usdt.safeTransfer(settlement.creator, amount);

        emit CommissionReleased(orderId, settlement.creator, amount);
    }

    function getSettlement(bytes32 orderId) external view returns (Settlement memory) {
        return _settlements[orderId];
    }
}
