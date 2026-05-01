// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * Counter — minimal contract for the hedera-multisig walkthrough.
 *
 * Demonstrates three multi-sig surfaces in one contract:
 *
 *   - increment()         non-payable, anyone can call (shows function-call signing)
 *   - getCount() view     read-only (no signing needed; included for completeness)
 *   - withdraw()          admin-only — only the deployer's address can withdraw the
 *                         contract's HBAR balance (shows access-controlled function call)
 *   - receive()           accepts HBAR so the contract can hold a balance to withdraw
 *
 * The walkthrough deploys this from the threshold account, sends HBAR to the
 * contract address, then has the threshold key call `withdraw()` to sweep the
 * balance back. This proves the multi-sig flow works end-to-end for both
 * read/write contract operations and value transfer.
 */
contract Counter {
    address public immutable admin;
    uint256 public count;

    event Incremented(address indexed caller, uint256 newCount);
    event Withdrawn(address indexed to, uint256 amount);

    constructor() {
        admin = msg.sender;
    }

    function increment() external {
        unchecked { count = count + 1; }
        emit Incremented(msg.sender, count);
    }

    function getCount() external view returns (uint256) {
        return count;
    }

    function withdraw() external {
        require(msg.sender == admin, "not admin");
        uint256 bal = address(this).balance;
        (bool ok, ) = payable(admin).call{value: bal}("");
        require(ok, "withdraw failed");
        emit Withdrawn(admin, bal);
    }

    receive() external payable {}
}
