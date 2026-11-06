// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ICampaignRegistry} from "./interfaces/ICampaignRegistry.sol";

/// @notice Campaign terms and creator approvals. Holds no funds; NumaRouter reads this
/// contract to decide whether an order is settleable and whether a creator is approved.
contract CampaignRegistry is ICampaignRegistry {
    uint96 public constant MAX_COMMISSION_BPS = 5000; // 50%

    uint256 private _nextCampaignId = 1;

    mapping(uint256 => Campaign) private _campaigns;
    mapping(uint256 => mapping(address => bool)) private _approvedCreators;

    modifier onlyMerchant(uint256 campaignId) {
        Campaign storage c = _campaigns[campaignId];
        require(c.exists, "CampaignRegistry: unknown campaign");
        require(c.merchant == msg.sender, "CampaignRegistry: not merchant");
        _;
    }

    /// @notice Create a campaign. `payoutSigner` and `commissionBps` are immutable for the
    /// campaign's lifetime — a merchant that wants different terms creates a new campaign,
    /// so approved creators and in-flight orders can never be rug-pulled by a silent terms change.
    function createCampaign(address payoutSigner, uint96 commissionBps, uint64 endsAt)
        external
        returns (uint256 campaignId)
    {
        require(payoutSigner != address(0), "CampaignRegistry: zero payoutSigner");
        require(commissionBps <= MAX_COMMISSION_BPS, "CampaignRegistry: commission too high");
        require(endsAt > block.timestamp, "CampaignRegistry: endsAt in past");

        campaignId = _nextCampaignId++;
        _campaigns[campaignId] = Campaign({
            merchant: msg.sender,
            payoutSigner: payoutSigner,
            commissionBps: commissionBps,
            endsAt: endsAt,
            paused: false,
            exists: true
        });

        emit CampaignCreated(campaignId, msg.sender, payoutSigner, commissionBps, endsAt);
    }

    function approveCreator(uint256 campaignId, address creator) external onlyMerchant(campaignId) {
        require(creator != address(0), "CampaignRegistry: zero creator");
        _approvedCreators[campaignId][creator] = true;
        emit CreatorApproved(campaignId, creator);
    }

    function revokeCreator(uint256 campaignId, address creator) external onlyMerchant(campaignId) {
        _approvedCreators[campaignId][creator] = false;
        emit CreatorRevoked(campaignId, creator);
    }

    function pause(uint256 campaignId, bool paused) external onlyMerchant(campaignId) {
        _campaigns[campaignId].paused = paused;
        emit CampaignPaused(campaignId, paused);
    }

    function getCampaign(uint256 campaignId) external view returns (Campaign memory) {
        return _campaigns[campaignId];
    }

    function isCreatorApproved(uint256 campaignId, address creator) external view returns (bool) {
        return _approvedCreators[campaignId][creator];
    }

    function isSettleable(uint256 campaignId) external view returns (bool) {
        Campaign storage c = _campaigns[campaignId];
        return c.exists && !c.paused && block.timestamp <= c.endsAt;
    }
}
