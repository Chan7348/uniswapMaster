# Uniswap V2和V3的笔记 by Dropnear

## V2

市面上已经有非常多关于Uniswap V2和V3数学公式和技术细节的讲解文章，这些文章帮助小白们对Uniswap的基础原理有了一定认识。然而，对于开发者来说，有些知识不仅无助于理解Uniswap的实现原理，甚至可能有害，使代码更加难以理解。拿Uniswap V2的核心公式 \( x \times y = k \) 举例，很多文章为了帮助小白理解，会说“swap前后乘积不变”，但在代码运行过程中，k的值真的不变吗？答案是否定的！

Uniswap V2 的核心是`swap`函数，我们来看一下`swap`函数的代码：

```solidity
function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external lock {
        require(amount0Out > 0 || amount1Out > 0, 'UniswapV2: INSUFFICIENT_OUTPUT_AMOUNT');
        (uint112 _reserve0, uint112 _reserve1,) = getReserves(); // gas savings
        require(amount0Out < _reserve0 && amount1Out < _reserve1, 'UniswapV2: INSUFFICIENT_LIQUIDITY');

        uint balance0;
        uint balance1;
        { // scope for _token{0,1}, avoids stack too deep errors
        address _token0 = token0;
        address _token1 = token1;
        require(to != _token0 && to != _token1, 'UniswapV2: INVALID_TO');
        if (amount0Out > 0) _safeTransfer(_token0, to, amount0Out); // optimistically transfer tokens
        if (amount1Out > 0) _safeTransfer(_token1, to, amount1Out); // optimistically transfer tokens
        if (data.length > 0) IUniswapV2Callee(to).uniswapV2Call(msg.sender, amount0Out, amount1Out, data);
        balance0 = IERC20(_token0).balanceOf(address(this));
        balance1 = IERC20(_token1).balanceOf(address(this));
        }
        uint amount0In = balance0 > _reserve0 - amount0Out ? balance0 - (_reserve0 - amount0Out) : 0;
        uint amount1In = balance1 > _reserve1 - amount1Out ? balance1 - (_reserve1 - amount1Out) : 0;
        require(amount0In > 0 || amount1In > 0, 'UniswapV2: INSUFFICIENT_INPUT_AMOUNT');
        { // scope for reserve{0,1}Adjusted, avoids stack too deep errors
        uint balance0Adjusted = balance0.mul(1000).sub(amount0In.mul(3));
        uint balance1Adjusted = balance1.mul(1000).sub(amount1In.mul(3));
        require(balance0Adjusted.mul(balance1Adjusted) >= uint(_reserve0).mul(_reserve1).mul(1000**2), 'UniswapV2: K');
        }

        _update(balance0, balance1, _reserve0, _reserve1);
        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }
```

在讲解这个函数之前，我们要认识一下几个变量：
- **balance0/balance1:** 合约中token0/token1的余额
- **reserve0/reserve1:** 池子中用于做市的token0/token1的数量
- **amount0In/amount1In:** 此合约新获得的token0/token1的数量
- **amount0Out/amount1Out:** 用户想要通过函数得到的token0/token1的数量

我们首先要明白，合约有多少代币不等于池子中有多少代币。由于ERC20的特性，我们无法阻止任何人向合约进行转账，所以在核心的`swap`函数中，我们只能通过计算合约中代币数量和池子中代币数量的差额来推断用户向我们转入了多少代币即amountIn。当你理解了这一点之后，对于`swap`函数的理解就会简单很多。

### 入参：
- **amount0Out:** 用户想要通过`swap`函数得到的token0的数量
- **amount1Out:** 用户想要通过`swap`函数得到的token1的数量
- **to:** 目标地址
- **data:** 是否开启闪电兑换模式

### 普通模式：

1. 一切必要的检查以及变量初始化。
2. 根据入参的数量把用户所有想要得到的代币转给用户。
3. 检查amount中是否有足够的新增代币，只要balance的乘积相对于reserve是不变或者增加的，即池子的深度不变或者增加，就继续执行。
4. 更新reserve，即池子的深度。

由于交易的特性，`swap`过程中任何环节出了问题，我们就可以将整个交易全部回滚，所以我们可以放心地先把用户想要的代币数量交给用户，再检查有没有给够钱。还有一点我们需要注意，由于交易是否成功只用交易前后的token数量乘积来判断，所以用户在交易的过程中可以有多种选择：
1. 输入一种代币，得到一种代币
2. 输入一种代币，得到两种代币
3. 输入两种代币，得到一种代币
4. 输入两种代币，得到两种代币

### 闪电兑换流程：

1. 一切必要的检查以及变量初始化。
2. 根据入参的数量把用户所有想要得到的代币转给用户。
3. 检测到用户输入的data不为空，调用to合约的`uniswapV2Call`函数，这个函数是用户自定义的，可以在这个函数中实现一些自定义的逻辑。
4. 检查amount中是否有足够的新增代币，只要balance的乘积相对于reserve是不变或者增加的，即池子的深度不变或者增加，就继续执行。
5. 更新reserve，即池子的深度。

与普通模式不同的地方就在于第三条，执行用户自定义合约的逻辑。我们可以用这个函数实现一些非常了不起的功能。举一个简单的例子，在传统世界，没有期货/永续合约这类金融产品之前，看空某个标的是有一定难度的，我们往往需要先借入这个标的，然后再卖出以开空。我们手中只持有稳定币没有ETH，而我们又想看空ETH。我们应该怎么办呢？在我们的例子中，我们可以先持有一定数量的稳定币，然后在`swap`函数中，先拿到兑换后的ETH，调用回调函数抵押ETH借入稳定币，再把手中的稳定币还给`swap`函数，这样我们就实现了看空ETH的目的。

总结：我们可以看到，在swap的过程中，只要池子的深度大于等于之前的深度，合约就会判断通过，所以池子的深度k可以是增加的。



## V3
问题：maxLiquidityPerTick, 防止总流动性溢出uint128，为什么需要这个？

创建新池子的过程：
    首先调用NonfungiblePositionManager继承自PoolInitializer的createAndInitializePoolIfNecessary()函数，这个函数会：
       1. 首先调用getPool()计算池子的地址
       2. 查看pool合约是否已经被创建，如果没有则
          1. 调用factory的createPool()，该函数会根据fee设置合适的tickSpacing，并把pool的相关信息存入factory中
          2. 在createPool()中调用deploy(), new一个新的pool合约，并把合约信息存在factory中
          3. 调用新创建的pool合约，调用initialize(sqrtPriceX96),对池子进行初始化，设置初始价格和对应的tick
       3. 如果已经创建，且池子没有价格，调用池子initialize()进行价格的初始化

mint一个新的NFTposition：
    确认池子已初始化 -> 计算mint所需流动性 -> 调用pool的mint函数 -> 利用liquidity对position进行更新 -> 调用回调函数实现token的转移 -> 检测token的转移并触发事件

    _modifyPosition():
        _updatePosition() 用于 修改position -> 根据加流动性的三种情况，包含现价/在现价上方/在现价下方 计算amount -> 返回更新后的position和需要的token数量

    _updatePosition():
        更新 lower tick 和 upper tick，并查看是否需要对tick进行翻转 -> 更新position的数据 -> 如果是减少流动性则清除对应的tick数据

swap:
    外部Router选择exactInput或者exactOutput模式并设置限价,交易方向和多重池子路径 ->  swap() 进入循环 (token消耗完/到达限价即停止) {
        每跨越一个tick就是一个循环 -> 更新剩余需要兑换的量和拿到的量 -> 检查是否需要跨越tick -> 更新价格和tick -> 得到本次循环的处理过的amount0和拿到的amount1 -> transfer token
    }

增加liquidity:
    params:
        1. NFT tokenid
        2. 提供的amount0
        3. 提供的amount1
        4. 成功mint进的amount0最低值
        5. 成功mint进的amount1最低值
        6. 有效期
    调用父合约 addLiquidity() 计算mint得到的liquidity和需要的token amount并向指定头寸mint -> 计算手续费和token欠款 -> 更新liquidity fee

减少liquidity:
    params:
        1. NFT tokenid
        2. 要减少的liquidity数量
        3. 拿到amount0最低值
        4. 拿到amount1最低值
        5. 有效期
    调用pool的burn函数，修改position并给出池子退回的token amount，累积到tokensOwed -> 结算之前的收益并更新手续费相关字段


移除一个NFTposition:
    先移除所有的流动性 -> burn NFT 