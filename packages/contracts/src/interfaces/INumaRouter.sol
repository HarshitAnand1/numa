// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface INumaRouter {
    struct Order {
        uint256 campaignId;
        address merchant;
        address creator;
        address buyer;
        uint256 gross;
        bytes32 orderId;
        uint256 deadline;
    }

    struct Settlement {
        address merchant;
        address creator;
        address buyer;
        uint256 gross;
        uint256 commission;
        uint256 fee;
        uint256 heldCommission;
        uint256 refundedGross;
        uint256 paidAt;
        bool released;
        bool exists;
    }

    event OrderSettled(
        bytes32 indexed orderId,
        uint256 indexed campaignId,
        address indexed merchant,
        address creator,
        address buyer,
        uint256 gross,
        uint256 merchantNet,
        uint256 commission,
        uint256 fee
    );

    event OrderRefunded(
        bytes32 indexed orderId, uint256 refundAmount, uint256 commissionClawback, uint256 merchantPulled
    );

    event CommissionReleased(bytes32 indexed orderId, address indexed creator, uint256 amount);

    function payOrder(
        Order calldata order,
        bytes calldata merchantSignature,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 authNonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    function refund(bytes32 orderId, uint256 refundAmount) external;

    function release(bytes32 orderId) external;

    function getSettlement(bytes32 orderId) external view returns (Settlement memory);
}
