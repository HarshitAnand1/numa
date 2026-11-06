// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CampaignRegistry} from "../src/CampaignRegistry.sol";
import {ICampaignRegistry} from "../src/interfaces/ICampaignRegistry.sol";

contract CampaignRegistryTest is Test {
    CampaignRegistry registry;

    address merchant = makeAddr("merchant");
    address otherMerchant = makeAddr("otherMerchant");
    address payoutSigner = makeAddr("payoutSigner");
    address creator = makeAddr("creator");

    function setUp() public {
        registry = new CampaignRegistry();
        vm.warp(1_700_000_000);
    }

    function _createCampaign(address who, uint96 commissionBps, uint64 endsAt) internal returns (uint256) {
        vm.prank(who);
        return registry.createCampaign(payoutSigner, commissionBps, endsAt);
    }

    function test_createCampaign() public {
        uint256 id = _createCampaign(merchant, 1000, uint64(block.timestamp + 7 days));
        ICampaignRegistry.Campaign memory c = registry.getCampaign(id);
        assertEq(c.merchant, merchant);
        assertEq(c.payoutSigner, payoutSigner);
        assertEq(c.commissionBps, 1000);
        assertTrue(c.exists);
        assertFalse(c.paused);
        assertTrue(registry.isSettleable(id));
    }

    function test_createCampaign_revertsOnCommissionAboveMax() public {
        vm.prank(merchant);
        vm.expectRevert("CampaignRegistry: commission too high");
        registry.createCampaign(payoutSigner, 5001, uint64(block.timestamp + 7 days));
    }

    function test_createCampaign_allowsExactlyMaxCommission() public {
        uint256 id = _createCampaign(merchant, 5000, uint64(block.timestamp + 7 days));
        assertEq(registry.getCampaign(id).commissionBps, 5000);
    }

    function test_createCampaign_revertsOnPastEndsAt() public {
        vm.prank(merchant);
        vm.expectRevert("CampaignRegistry: endsAt in past");
        registry.createCampaign(payoutSigner, 1000, uint64(block.timestamp - 1));
    }

    function test_createCampaign_revertsOnZeroPayoutSigner() public {
        vm.prank(merchant);
        vm.expectRevert("CampaignRegistry: zero payoutSigner");
        registry.createCampaign(address(0), 1000, uint64(block.timestamp + 7 days));
    }

    function test_approveCreator() public {
        uint256 id = _createCampaign(merchant, 1000, uint64(block.timestamp + 7 days));
        vm.prank(merchant);
        registry.approveCreator(id, creator);
        assertTrue(registry.isCreatorApproved(id, creator));
    }

    function test_approveCreator_revertsForNonMerchant() public {
        uint256 id = _createCampaign(merchant, 1000, uint64(block.timestamp + 7 days));
        vm.prank(otherMerchant);
        vm.expectRevert("CampaignRegistry: not merchant");
        registry.approveCreator(id, creator);
    }

    function test_revokeCreator() public {
        uint256 id = _createCampaign(merchant, 1000, uint64(block.timestamp + 7 days));
        vm.startPrank(merchant);
        registry.approveCreator(id, creator);
        registry.revokeCreator(id, creator);
        vm.stopPrank();
        assertFalse(registry.isCreatorApproved(id, creator));
    }

    function test_revokeCreator_revertsForNonMerchant() public {
        uint256 id = _createCampaign(merchant, 1000, uint64(block.timestamp + 7 days));
        vm.prank(merchant);
        registry.approveCreator(id, creator);

        vm.prank(otherMerchant);
        vm.expectRevert("CampaignRegistry: not merchant");
        registry.revokeCreator(id, creator);
    }

    function test_pause_blocksSettlement() public {
        uint256 id = _createCampaign(merchant, 1000, uint64(block.timestamp + 7 days));
        vm.prank(merchant);
        registry.pause(id, true);
        assertFalse(registry.isSettleable(id));

        vm.prank(merchant);
        registry.pause(id, false);
        assertTrue(registry.isSettleable(id));
    }

    function test_pause_revertsForNonMerchant() public {
        uint256 id = _createCampaign(merchant, 1000, uint64(block.timestamp + 7 days));
        vm.prank(otherMerchant);
        vm.expectRevert("CampaignRegistry: not merchant");
        registry.pause(id, true);
    }

    function test_isSettleable_falseAfterEndsAt() public {
        uint64 endsAt = uint64(block.timestamp + 1 days);
        uint256 id = _createCampaign(merchant, 1000, endsAt);
        assertTrue(registry.isSettleable(id));

        vm.warp(endsAt + 1);
        assertFalse(registry.isSettleable(id));
    }

    function test_isSettleable_falseForUnknownCampaign() public {
        assertFalse(registry.isSettleable(999));
    }

    function testFuzz_createCampaign_rejectsCommissionAboveMax(uint96 commissionBps) public {
        vm.assume(commissionBps > 5000);
        vm.prank(merchant);
        vm.expectRevert("CampaignRegistry: commission too high");
        registry.createCampaign(payoutSigner, commissionBps, uint64(block.timestamp + 7 days));
    }

    function testFuzz_createCampaign_acceptsValidCommission(uint96 commissionBps) public {
        commissionBps = uint96(bound(commissionBps, 0, 5000));
        uint256 id = _createCampaign(merchant, commissionBps, uint64(block.timestamp + 7 days));
        assertEq(registry.getCampaign(id).commissionBps, commissionBps);
    }
}
