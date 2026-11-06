// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {CampaignRegistry} from "../src/CampaignRegistry.sol";
import {NumaRouter} from "../src/NumaRouter.sol";

/// @notice Deploys CampaignRegistry then NumaRouter, wired together. Run with `--broadcast` to
/// actually send transactions — without it, this only simulates (see
/// .agents/skills/whitechain-dev/references/deploy-contract.md).
///
/// Required env vars:
/// - USDT_ADDRESS: Whitechain testnet USDT (see docs/WHITECHAIN.md)
/// - FEE_RECIPIENT: protocol fee recipient address
/// - FEE_BPS: protocol fee in basis points, max 100 (1%)
/// - REFUND_WINDOW_SECONDS: seconds after settlement before `release()` is callable
contract DeployScript is Script {
    function run() external {
        address usdt = vm.envAddress("USDT_ADDRESS");
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        uint96 feeBps = uint96(vm.envUint("FEE_BPS"));
        uint256 refundWindow = vm.envUint("REFUND_WINDOW_SECONDS");

        vm.startBroadcast();

        CampaignRegistry registry = new CampaignRegistry();
        NumaRouter router = new NumaRouter(usdt, address(registry), feeRecipient, feeBps, refundWindow);

        vm.stopBroadcast();

        console.log("CampaignRegistry:", address(registry));
        console.log("NumaRouter:", address(router));
    }
}
