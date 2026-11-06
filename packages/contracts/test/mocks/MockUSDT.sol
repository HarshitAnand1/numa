// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Minimal EIP-3009 `receiveWithAuthorization` mock mirroring the behavior verified on
/// Whitechain testnet USDT (6 decimals, `receiveWithAuthorization` requires msg.sender == to).
/// Test-only; not a general-purpose EIP-3009 reference implementation.
contract MockUSDT is ERC20, EIP712 {
    bytes32 private constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    mapping(address => mapping(bytes32 => bool)) private _authorizationStates;

    constructor() ERC20("Mock Tether USD", "mUSDT") EIP712("Mock Tether USD", "1") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool) {
        return _authorizationStates[authorizer][nonce];
    }

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
    ) external {
        require(msg.sender == to, "MockUSDT: caller must be payee");
        require(block.timestamp > validAfter, "MockUSDT: authorization not yet valid");
        require(block.timestamp < validBefore, "MockUSDT: authorization expired");
        require(!_authorizationStates[from][nonce], "MockUSDT: authorization used");

        bytes32 structHash =
            keccak256(abi.encode(RECEIVE_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce));
        address signer = ECDSA.recover(_hashTypedDataV4(structHash), v, r, s);
        require(signer == from, "MockUSDT: invalid authorization signature");

        _authorizationStates[from][nonce] = true;
        _transfer(from, to, value);
    }
}
