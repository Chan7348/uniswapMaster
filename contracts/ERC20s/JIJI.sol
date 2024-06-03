// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

// import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
contract JIJI is ERC20Permit {
    constructor() ERC20("kin", "ikun") {
        _mint(msg.sender, 1e29);
    }
    function decimals() public override pure returns (uint8) {
        return 3;
    }
}