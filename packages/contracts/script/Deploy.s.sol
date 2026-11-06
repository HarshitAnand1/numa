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
///
/// Optional env vars:
/// - EXPECTED_CHAIN_ID: if set, the script aborts before broadcasting unless `block.chainid`
///   matches exactly. Defaults to 1874 (Whitechain Sepolia) when unset. Pass 1875 explicitly for
///   a Mainnet deploy — this script does not assume Mainnet is ever the right default.
///
/// Safety checks performed before any `vm.startBroadcast()`:
/// - `block.chainid` matches `EXPECTED_CHAIN_ID` (refuses to deploy to the wrong network)
/// - `usdt_`/`feeRecipient` are non-zero and `usdt_` has deployed code
/// - `feeBps` is within `NumaRouter`'s own constructor-enforced bound (checked here too, so the
///   failure is a clear require message in the simulation log, not just a generic constructor
///   revert)
/// - the deployer's native-token (WBT) balance is logged so an operator can catch "zero balance,
///   this will fail on broadcast" before spending time on a `--broadcast` run that reverts on gas
///
/// On a successful broadcast, writes a deployment manifest to
/// `deployments/<chainid>-<timestamp>.json` recording both addresses, constructor args, deployer,
/// and block number, so there is a durable record independent of console scrollback.
contract DeployScript is Script {
    uint256 internal constant DEFAULT_EXPECTED_CHAIN_ID = 1874;

    function run() external {
        address usdt = vm.envAddress("USDT_ADDRESS");
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        uint96 feeBps = uint96(vm.envUint("FEE_BPS"));
        uint256 refundWindow = vm.envUint("REFUND_WINDOW_SECONDS");
        uint256 expectedChainId = vm.envOr("EXPECTED_CHAIN_ID", DEFAULT_EXPECTED_CHAIN_ID);

        require(block.chainid == expectedChainId, "Deploy: wrong network for EXPECTED_CHAIN_ID");
        require(usdt != address(0), "Deploy: USDT_ADDRESS is zero");
        require(usdt.code.length > 0, "Deploy: USDT_ADDRESS is not a contract on this chain");
        require(feeRecipient != address(0), "Deploy: FEE_RECIPIENT is zero");
        require(feeBps <= 100, "Deploy: FEE_BPS exceeds NumaRouter's 1% cap");
        require(refundWindow <= 365 days, "Deploy: REFUND_WINDOW_SECONDS exceeds NumaRouter's 365-day cap");

        address deployer = tx.origin;
        console.log("Deployer:", deployer);
        console.log("Deployer WBT balance (wei):", deployer.balance);
        console.log("Chain ID:", block.chainid);
        if (deployer.balance == 0) {
            console.log("WARNING: deployer has zero native-token balance; --broadcast will fail on gas.");
        }

        vm.startBroadcast();

        CampaignRegistry registry = new CampaignRegistry();
        NumaRouter router = new NumaRouter(usdt, address(registry), feeRecipient, feeBps, refundWindow);

        vm.stopBroadcast();

        console.log("CampaignRegistry:", address(registry));
        console.log("NumaRouter:", address(router));

        // Post-deploy sanity: read back the immutables we just set, rather than trusting the
        // constructor args we passed in — catches a mismatched ABI/bytecode deployment.
        require(address(router.usdt()) == usdt, "Deploy: router.usdt() mismatch post-deploy");
        require(address(router.registry()) == address(registry), "Deploy: router.registry() mismatch post-deploy");
        require(router.feeRecipient() == feeRecipient, "Deploy: router.feeRecipient() mismatch post-deploy");
        require(router.feeBps() == feeBps, "Deploy: router.feeBps() mismatch post-deploy");

        _writeManifest(registry, router, usdt, feeRecipient, feeBps, refundWindow, deployer);
    }

    function _writeManifest(
        CampaignRegistry registry,
        NumaRouter router,
        address usdt,
        address feeRecipient,
        uint96 feeBps,
        uint256 refundWindow,
        address deployer
    ) internal {
        string memory obj = "manifest";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeUint(obj, "blockNumber", block.number);
        vm.serializeAddress(obj, "deployer", deployer);
        vm.serializeAddress(obj, "campaignRegistry", address(registry));
        vm.serializeAddress(obj, "numaRouter", address(router));
        vm.serializeAddress(obj, "usdt", usdt);
        vm.serializeAddress(obj, "feeRecipient", feeRecipient);
        vm.serializeUint(obj, "feeBps", feeBps);
        string memory json = vm.serializeUint(obj, "refundWindowSeconds", refundWindow);

        string memory dir = "deployments";
        vm.createDir(dir, true);
        string memory path =
            string.concat(dir, "/", vm.toString(block.chainid), "-", vm.toString(block.timestamp), ".json");
        vm.writeJson(json, path);
        console.log("Deployment manifest written to:", path);
    }
}
