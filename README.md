In development~

# Uniswap V2和V3的讲解 by Dropnear

## V2

``` solidity
contract MyContract {
    uint public myNumber;

    function setMyNumber(uint _myNumber) public {
        myNumber = _myNumber;
    }

    function getMyNumber() public view returns (uint) {
        return myNumber;
    }
}
```