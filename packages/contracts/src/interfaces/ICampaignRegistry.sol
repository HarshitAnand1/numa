// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface ICampaignRegistry {
    struct Campaign {
        address merchant;
        address payoutSigner;
        uint96 commissionBps;
        uint64 endsAt;
        bool paused;
        bool exists;
    }

    event CampaignCreated(
        uint256 indexed campaignId, address indexed merchant, address payoutSigner, uint96 commissionBps, uint64 endsAt
    );
    event CreatorApproved(uint256 indexed campaignId, address indexed creator);
    event CreatorRevoked(uint256 indexed campaignId, address indexed creator);
    event CampaignPaused(uint256 indexed campaignId, bool paused);

    function createCampaign(address payoutSigner, uint96 commissionBps, uint64 endsAt)
        external
        returns (uint256 campaignId);

    function approveCreator(uint256 campaignId, address creator) external;

    function revokeCreator(uint256 campaignId, address creator) external;

    function pause(uint256 campaignId, bool paused) external;

    function getCampaign(uint256 campaignId) external view returns (Campaign memory);

    function isCreatorApproved(uint256 campaignId, address creator) external view returns (bool);

    function isSettleable(uint256 campaignId) external view returns (bool);
}
