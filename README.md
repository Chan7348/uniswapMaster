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

## 创建新池子的过程

### 调用 `createAndInitializePoolIfNecessary()`

1. **调用 `getPool()`**：
   - 计算池子的地址。

2. **查看池合约是否已经被创建**：
   - 如果没有：
     1. 调用 factory 的 `createPool()`：
        - 根据 fee 设置合适的 `tickSpacing`。
        - 将池的相关信息存入 factory 中。
     2. 在 `createPool()` 中调用 `deploy()`：
        - 创建一个新的池合约，并将合约信息存入 factory 中。
     3. 调用新创建的池合约的 `initialize(sqrtPriceX96)`：
        - 对池子进行初始化，设置初始价格和对应的 tick。

   - 如果已经创建，且池子没有价格：
     - 调用池子的 `initialize()` 进行价格的初始化。


swap中，我们要在同一个word中找到下一个初始化过的tick或者返回下一个word的开头tick，这个目标tick是用nextInitializedTickWithinOneWord()寻找的

tickSpacing只有两个点用到
_updatePosition 翻转tick
swap过程中 找到下一个可用的端点


swap while循环的目的：只在当前word中寻找，让单次交易的tick跨度不会太大，减少计算中溢出的可能性

注意区分跨tick，跨端点，跨word的区别！

swap():
1. 储存cache和state
2. 循环中：
   1. 把现价存储为PriceStart，标志着本次循环的起始价格
   2. 存储同一个word中的下一个端点tickNext和对应的价格，如果没有就存储下一个word的开头tick(这样做的目的是方便下次循环中，我们可以直接使用word开头的tick进行寻找)
   3. 根据tickNext对应的价格进行computeSwapStep，尝试移动到tickNext并给出本次computeSwapStep的amountIn和amountOut
   4. 如果
      1. 成功移动到下一端点：更新net，state.liquidity，tick
      2. 没有成功移动到下一个端点：更新tick，这种情况下就是说我们走到的是下一个word的开头tick

      3. 如果不是以上两种情况，并且price跟循环的priceStart不同，也就是价格发生移动了：这种情况我们swap已经结束，重新计算tick，不跨端点，也不跨word
3. 循环结束，先检测swap前后tick是否变化：true -> 更新预言机，price，tick
                                    false -> 未跨tick，只更新price
4. 如果跨端点了，要更新全局liquidity
5. 根据循环结果，计算amount
6. 根据swap方向，进行token的转移，callback



computeSwapStep(sqrtRatioCurrentX96, sqrtRatioTargetX96, liquidity, amountRemaining, feePips): -> (sqrtRatioNextX96, amountIn, amountOut, feeAmount)
这个函数用于处理不跨端点时的swap过程，也就是普通的amm公式 （这函数可读性实在是太差了，估计是为了极致地省gas）
第二个参数targetPrice入参计算方式：
   如果：
      1. 0for1 -> limit/next 大的一个  如果是0for1价格会下降，所以会先碰到大的一个
      2. 1for0 -> limit/next 小的一个  如果是1for0价格会上升，所以会先碰到小的一个
   
1. exactIn
   1. 先扣除LP费用，更新remaining
   2. 根据liquidity和两个price，算出需要多少amountIn
   3. 如果
      max. remaining足够支撑价格变动 -> 直接返回Target价格
      notMax. 我们的remaining不够，停在半路 -> 就要计算到我们能移动到什么价格
   4. 根据liquidity和两个price，算出需要多少amountOut
   5. 如果
      notMax. 用初始的remaining - amoutIn，剩下的部分都归为手续费
      max. 按amountIn和比例算出要多少fee，这里有一个rounding up
   6. 返回priceNext，两个amount，和fee
2. exactOut
   1. 根据liquidity和两个price，算出需要多少amountOut
   2. 如果
      max. remaining足够支撑价格变动 -> 直接返回Target价格
      notMax. remaining不够，停在半路 -> 计算出停止到了哪个价格
   3. 根据liquidity和两个价格，算出amountIn
   4. 如果amountOut超过了remaining，也就是说停在了半路，也就是说我们的PriceNext是根据remaining计算出来的，那么我们就要用amountRemaining替换掉amountOut
   5. 按amountIn和比例算出fee，这里有一个rounding up


nextInitializedTickWithinOneWord(tick, tickSpacing, lte) -> (next, initialized)
在同一个word中，找出下一个端点，如果没有的话就停在下一个word的开头，便于下一轮循环
在word这个uint256结构中，我们每一位从小到大的tick是按照从低位到高位的方式存储的，比如 100000，这个1其实是存储在了第六号位置
所以在同一个word中，如果我们swap 为 0for1，实际上tick向下寻找，是在向右寻找低位 / 如果我们的swap为1for0，实际上tick向上寻找，是在向左寻找高位
word之间的顺序还是正序的
下面来看看代码实现：

position(tick) -> (wordPos, bitPos)
这个函数用于获取指定tick所在的word，并给出其在内部的位置
```solidity
wordPos = int16(tick >> 8); // 将tick向右进8位，相当于将数除以2^8=256, tick / 2^8 也就是我们所在的word的位置
bitPos = uint8(tick % 256); // 拿到刚刚的余数，这个余数也就是我们的tick在这个word中的相对位置
```

flipTick(tick, tickSpacing)
这个函数用于将bitmap上的端点进行翻转，0->1 or 1->0
```solidity
require(tick % tickSpacing == 0); // tick必须是在tickSpacing上的可初始化的点
(int16 wordPos, uint8 bitPos) = position(tick / tickSpacing);
uint256 mask = 1 << bitPos;// 2 ^ bitPos 生成掩码，除了tick处为1之外所有的数字都为0
self[wordPos] ^= mask; // 将Bitmap与我们的掩码进行 异或 ，就能将我们的tick翻转
```

nextInitializedTickWithinOneWord(tick, tickSpacing, lte) -> (next, initialized)
```solidity
int24 compressed = tick / tickSpacing; /// 对tick进行压缩
if (tick < 0 && tick % tickSpacing != 0) compressed--; // 向负无穷取整
```
这里的压缩是为了忽略spacing中间的tick，便于计算

```solidity
if (lte) {
   (int16 wordPos, uint8 bitPos) = position(compressed);
   uint256 mask = (1 << bitPos) - 1 + (1 << bitPos);// 这个掩码是, 当前bitPos及右边的所有位都为1
   uint256 masked = self[wordPos] & mask; // 将掩码覆盖在当前word上获取右边的所有位，进行按位与操作，也就是说我们清除bitPos左侧的1，只保留其右侧的1。
   initialized = masked != 0; // 检查右侧有没有1
   next = initialized
       ? (compressed - int24(bitPos - BitMath.mostSignificantBit(masked))) * tickSpacing // 找到第一个1即最大的那个1，跳到目标位置
       : (compressed - int24(bitPos)) * tickSpacing;// 右侧没有1的话，也就是说没有可用端点，这种情况我们就需要跳到末尾
} else {
   // 1for0，价格上升
   (int16 wordPos, uint8 bitPos) = position(compressed + 1);// 从下一个tick的word开始
   uint256 mask = ~((1 << bitPos) - 1);
   uint256 masked = self[wordPos] & mas // 找出左侧的所有1
   // if there are no initialized ticks to the left of the current tick, return leftmost in the word
   initialized = masked != 0;
   // overflow/underflow is possible, but prevented externally by limiting both tickSpacing and tick
   next = initialized
       ? (compressed + 1 + int24(BitMath.leastSignificantBit(masked) - bitPos)) * tickSpacing
       : (compressed + 1 + int24(type(uint8).max - bitPos)) * tickSpacing;
}
```



---

### Swap

在 `swap` 中，我们要在同一个 word 中找到下一个初始化过的 tick 或者返回下一个 word 的开头 tick，这个目标 tick 是用 `nextInitializedTickWithinOneWord()` 寻找的。

`tickSpacing` 只有两个地方用到：
1. `_updatePosition` 翻转 tick
2. `swap` 过程中找到下一个可用的端点

`swap` while 循环的目的：只在当前 word 中寻找，让单次交易的 tick 跨度不会太大，减少计算中溢出的可能性。

**注意区分跨 tick，跨端点，跨 word 的区别！**

---

#### swap()

1. 储存 cache 和 state
2. 循环中：
    1. 把现价存储为 `PriceStart`，标志着本次循环的起始价格
    2. 存储同一个 word 中的下一个端点 `tickNext` 和对应的价格，如果没有就存储下一个 word 的开头 tick (这样做的目的是方便下次循环中，我们可以直接使用 word 开头的 tick 进行寻找)
    3. 根据 `tickNext` 对应的价格进行 `computeSwapStep`，尝试移动到 `tickNext` 并给出本次 `computeSwapStep` 的 `amountIn` 和 `amountOut`
    4. 如果：
        1. 成功移动到下一端点：更新 net，state.liquidity，tick
        2. 没有成功移动到下一个端点：更新 tick，这种情况下就是说我们走到的是下一个 word 的开头 tick
        3. 如果不是以上两种情况，并且 price 跟循环的 `priceStart` 不同，也就是价格发生移动了：这种情况我们 swap 已经结束，重新计算 tick，不跨端点，也不跨 word
3. 循环结束，先检测 swap 前后 tick 是否变化：true -> 更新预言机，price，tick；false -> 未跨 tick，只更新 price
4. 如果跨端点了，要更新全局 liquidity
5. 根据循环结果，计算 amount
6. 根据 swap 方向，进行 token 的转移，callback

---

### computeSwapStep

```computeSwapStep(sqrtRatioCurrentX96, sqrtRatioTargetX96, liquidity, amountRemaining, feePips) -> (sqrtRatioNextX96, amountIn, amountOut, feeAmount)```

这个函数用于处理不跨端点时的 swap 过程，也就是普通的 AMM 公式 （这函数可读性实在是太差了，估计是为了极致地省 gas）

第二个参数 `targetPrice` 入参计算方式：
- 如果：
  1. 0for1 -> limit/next 大的一个。如果是 0for1 价格会下降，所以会先碰到大的一个
  2. 1for0 -> limit/next 小的一个。如果是 1for0 价格会上升，所以会先碰到小的一个

1. **exactIn**
    1. 先扣除 LP 费用，更新 remaining
    2. 根据 liquidity 和两个 price，算出需要多少 `amountIn`
    3. 如果：
        - `max`. remaining 足够支撑价格变动 -> 直接返回 Target 价格
        - `notMax`. 我们的 remaining 不够，停在半路 -> 就要计算到我们能移动到什么价格
    4. 根据 liquidity 和两个 price，算出需要多少 `amountOut`
    5. 如果：
        - `notMax`. 用初始的 remaining - amountIn，剩下的部分都归为手续费
        - `max`. 按 `amountIn` 和比例算出要多少 fee，这里有一个 rounding up
    6. 返回 `priceNext`，两个 amount，和 fee
2. **exactOut**
    1. 根据 liquidity 和两个 price，算出需要多少 `amountOut`
    2. 如果：
        - `max`. remaining 足够支撑价格变动 -> 直接返回 Target 价格
        - `notMax`. remaining 不够，停在半路 -> 计算出停止到了哪个价格
    3. 根据 liquidity 和两个价格，算出 `amountIn`
    4. 如果 `amountOut` 超过了 remaining，也就是说停在了半路，也就是说我们的 `PriceNext` 是根据 remaining 计算出来的，那么我们就要用 `amountRemaining` 替换掉 `amountOut`
    5. 按 `amountIn` 和比例算出 fee，这里有一个 rounding up

---

### nextInitializedTickWithinOneWord

```nextInitializedTickWithinOneWord(tick, tickSpacing, lte) -> (next, initialized)```

在同一个 word 中，找出下一个端点，如果没有的话就停在下一个 word 的开头，便于下一轮循环。

在 word 这个 `uint256` 结构中，我们每一位从小到大的 tick 是按照从低位到高位的方式存储的，比如 `100000`，这个 1 其实是存储在了第六号位置。所以在同一个 word 中，如果我们 swap 为 `0for1`，实际上 tick 向下寻找，是在向右寻找低位。如果我们的 swap 为 `1for0`，实际上 tick 向上寻找，是在向左寻找高位。

word 之间的顺序还是正序的。下面来看看代码实现：

---

#### position(tick) -> (wordPos, bitPos)

这个函数用于获取指定 tick 所在的 word，并给出其在内部的位置：

```solidity
wordPos = int16(tick >> 8); // 将 tick 向右进 8 位，相当于将数除以 2^8=256, tick / 2^8 也就是我们所在的 word 的位置
bitPos = uint8(tick % 256); // 拿到刚刚的余数，这个余数也就是我们的 tick 在这个 word 中的相对位置
```

---

#### flipTick(tick, tickSpacing)

这个函数用于将 bitmap 上的端点进行翻转，0->1 or 1->0

```solidity
require(tick % tickSpacing == 0); // tick 必须是在 tickSpacing 上的可初始化的点
(int16 wordPos, uint8 bitPos) = position(tick / tickSpacing);
uint256 mask = 1 << bitPos; // 2 ^ bitPos 生成掩码，除了 tick 处为 1 之外所有的数字都为 0
self[wordPos] ^= mask; // 将 Bitmap 与我们的掩码进行 异或 ，就能将我们的 tick 翻转
```

---

#### nextInitializedTickWithinOneWord(tick, tickSpacing, lte) -> (next, initialized)

```solidity
int24 compressed = tick / tickSpacing; // 对 tick 进行压缩
if (tick < 0 && tick % tickSpacing != 0) compressed--; // 向负无穷取整
```

这里的压缩是为了忽略 spacing 中间的 tick，便于计算：

```solidity
if (lte) {
   (int16 wordPos, uint8 bitPos) = position(compressed);
   uint256 mask = (1 << bitPos) - 1 + (1 << bitPos); // 这个掩码是当前 bitPos 及右边的所有位都为 1
   uint256 masked = self[wordPos] & mask; // 将掩码覆盖在当前 word 上获取右边的所有位，进行按位与操作，也就是说我们清除 bitPos 左侧的 1，只保留其右侧的 1。
   initialized = masked != 0; // 检查右侧有没有 1
   next = initialized
       ? (compressed - int24(bitPos - BitMath.mostSignificantBit(masked))) * tickSpacing // 找到第一个 1 即最大的那个 1，跳到目标位置
       : (compressed - int24(bitPos)) * tickSpacing; // 右侧没有 1 的话，也就是说没有可用端点，这种情况我们就需要跳到末尾
} else {
   // 1for0，价格上升
   (int16 wordPos, uint8 bitPos) = position(compressed + 1); // 从下一个 tick 的 word 开始
   uint256 mask = ~((1 << bitPos) - 1);
   uint256 masked = self[wordPos] & mask; // 找出左侧的所有 1
   // if there are no initialized ticks to the left of the current tick, return leftmost in the word
   initialized = masked != 0;
   // overflow/underflow is possible, but prevented externally by limiting both tickSpacing and tick
   next = initialized
       ? (compressed + 1 + int24(BitMath.leastSignificantBit(masked) - bitPos)) * tickSpacing
       : (compressed + 1 + int24(type(uint8).max - bitPos)) * tickSpacing;
}
```

---

