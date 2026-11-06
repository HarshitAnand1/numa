// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice EIP-3009 `receiveWithAuthorization`, as implemented by Whitechain testnet USDT.
/// @dev Not part of OpenZeppelin; the official EIP-3009 reference interface.
interface IERC3009 {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);
}
