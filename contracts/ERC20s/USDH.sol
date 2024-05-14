// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract USDH is ERC20("USDH", "USDH") {
    constructor() {
        _mint(msg.sender, 1e22);
    }
}