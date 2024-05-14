// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract JIJI is ERC20("JIJI", "JIJI") {
    constructor() {
        _mint(msg.sender, 1e29);
    }
    function decimals() public override pure returns (uint8) {
        return 3;
    }
}