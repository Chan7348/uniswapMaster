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



# V3
### MATH
![image](https://github.com/Chan7348/uniswapMaster/assets/105479728/d0746c12-7d69-482c-8612-cd48e4cd1da8)
$$(x+\frac L{\sqrt{p_b}})\cdot(y+L\sqrt{p_a})=L^2$$
##### 对核心公式的理解：
LP侧：我们在ab两点加池子，也就是说我们需要添加尽可能少的liquidity，使得价格能够下降到a点，能够上涨到b点

对于 c->a 这个变动需求，我们的价格是在下降，trader(XforY/0for1)，所以我们只需要为trader提供token1就可以了

对于 c->b 这个变动需求，我们的价格是在上升，trader(YforX/1for0)，所以我们只需要为trader提供token0就可以了
#### 总结：池子价格变动的时候，需要消耗哪个token，我们就要提供哪个token
##### 练习题1: 
ETH/USDC 交易对，price为3000。现在我们要在(3000,3001)挂一个限价单，数额为1ETH，求价格触及3001时，我们手里的1ETH的平均卖出价格？

先算出我们提供的流动性：
$$\left(Δx_{real}+\frac{L}{\sqrt{3001}}\right)L\sqrt{3000}=L^{2}$$
$$L=\frac{\sqrt{3000}\sqrt{3001}ΔX_{real}}{\left(\sqrt{3001}-\sqrt{3000}\right)}$$
根据流动性再算出拿到的USDC数量：
$$\frac{L}{\sqrt{3001}}\left(Δy_{real}+L\sqrt{3000}\right)=L^{2}$$
$$Δy_{real}=\left(\sqrt{3001}-\sqrt{3000}\right)L$$
所以最终我们卖出的价格为：
$$P=\frac{Δy_{real}}{Δx_{real}}=\sqrt{3001}\sqrt{3000}$$

### TICK
tick分为以下两种:
   1. 普通tick -> 0
   2. 特殊tick,这些是可被初始化(当作端点)的tick，由tickSpacing决定，有以下两种状态：
      1. 已初始化(端点) 1
      2. 未初始化 0

tick.initialized在向上翻转时由tick.update()设为true，而cleartick时则是直接在ticks的mapping中删除对应元素

#### tickSpacingToMaxLiquidityPerTick(tickSpacing) -> (maxLiquidity)
根据tickSpacing找出uint128下每个tick最多能承载的流动性

#### getFeeGrowthInisde(self, tickLower, tickUpper, tickCurrent, feeGrowthGlobal0X128, feeGrowth) -> (feeGrowthInside0X128, feeGrowthInside1X128)
根据端点和currentTick的两种情况，分别找出token0和token1的feeinside

#### update(self, tick, tickCurrent, liquidityDelta, feeGrowthGlobal0X128, feeGrowthGlobal1X128, secondsPerLiquidityCumulativeX128, tickCumulative, time, upper, maxLiquidity) -> (flipped)
这个函数只会在mint和burn时使用，用于对tick内的数据进行更新(主要是gross和net)，并且返回是否被翻转(初始化/销毁端点)

#### cross(self, tick, feeGrowthGlobal0X128, feeGrowthGlobal1X128, secondsPerLiquidityCumulativeX128, tickCumulative, time) -> (liquidityNet)
在swap的循环中使用，用于处理跨越tick的所有操作
1. 用feeGrowthGlobal - outside，得到另一侧的fee
2. 用secondsPerLiquidityCumulative - outside, 得到另一侧的secondsPerLiquidity
3. 用tickCumulative - outside，得到另一侧的secondsOutside
4. 返回tickNext的liquidity

#### secondsOutside
用于记录在该刻度的另一边已经花费的时间，
每个时间点的t = time - tb - ta
想要计算两个时间点之间花费的时间需要找出对应时间点的 t1 - t2
比较不同刻度的tout没有意义，必须在两个刻度的tout都初始化之后，gross都大于0，给定开始时间和结束时间这个范围，计算流动性在该范围内的秒数，才有意义

**tickBitmap**: 储存所有tick的初始化信息(包含普通tick和特殊tick)
内部tick在word中存储
在 word 这个 `uint256` 结构中，我们每一位从小到大的 tick 是按照从低位到高位的方式存储的，比如 `100000`，这个 1 其实是存储在了第六号位置。
所以在同一个 word 中，如果我们 swap 为 `0for1`，实际上 tick 向下寻找，是在向右寻找低位。
如果我们的 swap 为 `1for0`，实际上 tick 向上寻找，是在向左寻找高位。
而word 之间的顺序还是正序的。

在swap的具体细节中，
```solidity
state.tick = zeroForOne ? step.tickNext - 1 : step.tickNext;
```

```
low tick  <--------------------- high tick
             0 for 1 价格下降
           ->      ->     ->
          0000 ｜ 0000 ｜ 0010   bitmap
 
          <---------------------
```

```
low tick  ---------------------> high tick
             1 for 0 价格上升
          <-      <-     <-
          0000 ｜ 0000 ｜ 0010   bitmap

          --------------------->
```
### 创建新池子的过程

#### 调用 `createAndInitializePoolIfNecessary()`

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

简要地说，将需求数量拆分，通过不断寻找下一个端点(在一个word中)，不断地创造出短暂的L不变的小区间以供x * y = k 的swap公式能够运行。

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

### 仍需深究的问题
#### 问题1:
nextInitializedTickWithinOneWord()里
```solidity
int24 compressed = tick / tickSpacing;
...
next = initialized
   ? (compressed - int24(bitPos - BitMath.mostSignificantBit(masked))) * tickSpacing // 快进到下一个可用的tick
   : (compressed - int24(bitPos)) * tickSpacing;
```
先压缩再乘回去这个操作为什么是不受影响的？

#### 问题2，3:

swap中
```solidity
if (state.sqrtPriceX96 == step.sqrtPriceNextX96) {
   if (step.initialized) {
       // check for the placeholder value, which we replace with the actual value the first time the swap
       // crosses an initialized tick
       if (!cache.computedLatestObservation) {
           (cache.tickCumulative, cache.secondsPerLiquidityCumulativeX128) = observations.observeSingle(
               cache.blockTimestamp,
               0,
               slot0Start.tick,
               slot0Start.observationIndex,
               cache.liquidityStart,
               slot0Start.observationCardinality
           );
           cache.computedLatestObservation = true;
       }
       int128 liquidityNet =
           ticks.cross( // 处理价格跨越一个tick时的所有逻辑，包括重新计算L净变化量 liquidityNet
               step.tickNext,
               (zeroForOne ? state.feeGrowthGlobalX128 : feeGrowthGlobal0X128),
               (zeroForOne ? feeGrowthGlobal1X128 : state.feeGrowthGlobalX128),
               cache.secondsPerLiquidityCumulativeX128,
               cache.tickCumulative,
               cache.blockTimestamp
           );
       // if we're moving leftward, we interpret liquidityNet as the opposite sign
       // safe because liquidityNet cannot be type(int128).min
       if (zeroForOne) liquidityNet = -liquidityNet;
       state.liquidity = LiquidityMath.addDelta(state.liquidity, liquidityNet);
   }
   state.tick = zeroForOne ? step.tickNext - 1 : step.tickNext;
}
```

### mint

=======
从外围合约来看，用户调用mint() external，传入token，tick，amountDesired，amountMin等参数
调用父合约LiquidityManagement的addLiquidity()，
1. 通过三个价格和amountDesired计算出liquidity数量
2. 调用pool的mint()拿到需要的amount0Int, amount1Int
   1. modifyPosition()
      1. updatePosition()
         1. 调用ticks.update()，更新ticks Info结构并记录此端点是否进行了翻转
         2. 如果端点进行了翻转，在tickBitmap中也进行相应的更新
         3. 如果减少流动性，且翻转了，那就是清空了单独位置的流动性，单独清除ticks的存储
      2. 加流动性的三种情况：
         1. 加在了现价上方，也就是说只需要加token0，计算出需要的数量并返回
         2. 包含了现价，我们需要单独算出两侧的amount，并且更新position
         3. 加在了现价下方，只需要加token1，计算出需要的数量并返回
3. 转换int格式，并且调用callback，data里面存储了 poolKey和payer两个信息，调用pay进行转账


### burn
根据NFT的tokenId，销毁这个NFT，要求其已经没有流动性

### increaseLiquidity

调用addLiquidity()
1. 通过三个价格和amountDesired计算出liquidity数量
2. 调用pool的mint()拿到需要的amount0Int, amount1Int
   1. modifyPosition()
      1. updatePosition()
         1. 调用ticks.update()，更新ticks Info结构并记录此端点是否进行了翻转
         2. 如果端点进行了翻转，在tickBitmap中也进行相应的更新
         3. 如果减少流动性，且翻转了，那就是清空了单独位置的流动性，单独清除ticks的存储
      2. 加流动性的三种情况：
         1. 加在了现价上方，也就是说只需要加token0，计算出需要的数量并返回
         2. 包含了现价，我们需要单独算出两侧的amount，并且更新position
         3. 加在了现价下方，只需要加token1，计算出需要的数量并返回
3. 转换int格式，并且调用callback，data里面存储了 poolKey和payer两个信息，调用pay进行转账
4. 更新手续费和这个外部存储的这个position的liquidity

### boost计算
为了算出V3相对于V2的boost，我们需要想明白什么是boost，我理解的boost是指，V3和V2提供相同流动性所需要token价值的比例

### flash
v2和v3的不同之处在于，v2的flash loan和 flash swap都是在swap函数中操作的，而V3则是分成了flash和swap两个函数来进行操作
flash借和还的token相同
swap借和还的token不同

flash中，对借款前后token数量的检查是每种token的数量都只能多不能少
swap中，通过core 中swap()函数的回调函数进行操作，同样是乐观转账

### fee
针对每一个position进行单独计算
针对单位L存储fee
用L * fee 算出对position所有者的欠款，用户提取fee之后对欠款进行更新

在计算过程中，通过将tickLower和tickUpper的feeOut，position的feeInside进行组合，计算出position中的手续费总和

#### 做LP收取手续费的全流程：

##### 创建position
EOA -> NFPManager.mint()
   添加完liquidity之后，找到目标position中的feeGrowthInside

NFPManager.mint() -> pool.mint() -> pool._modifyPosition() -> pool._updatePosition()
通过flobal和tickLower，tickUpper计算position内的feeGrowth

pool._updatePosition() -> positions.update()
通过两个inside和liquidityDelta，更新feeGrowthInside, 计算并累加tokensOwed

回到NFPManager.mint()
在_position映射中记录NFTid对应的position信息

##### swap过程中手续费的累积
pool.swap()
state中记录了token的globalfee，根据兑换方向拿到一个feeGrowth
在while循环中：
   每一次step的fee都要记录
   如果有feeProtocol要记录
   在remaining中扣除fee
   将本次得到的fee除以L，累加到feeGrowthGlobal上
   如有需要，根据方向，cross tick，更新feeOutside

##### 手续费的提取
NFPManager.collet() -> pool.burn()
使用burn来进行position的更新，然后更新tokensOwed， 并且调用pool.collect()


##### 手续费完结
总结就是，position流动性不变时，利用globalfee，和tick的outside，在_updatePosition中算出position的inside，再乘上流动性的数量就可以计算出position的手续费了。
如果position的流动性变动，需要重新进行计算
tokensOwed是在position中记录的，每次提取会扣取相应的数量

#### 对手续费算法的理解
feeOutside，该tick相对于currentTick外侧的累积fee。对于某一个tick，在swap时如果不被跨越，
这个值是固定的。swap过程中其实变化的是globalFee。两者相减，我们就能获取我们想要的deltafee。
对于固定值的记录，减少变量的调整，有助于提高整体算法的稳定性。

#### 举例
两个LP，A在(2000,3000)提供liquidity数量为L1，B在(2500,3500)提供liquidity数量为L2
以下tick指的均为价格所在处的tick
TICK -> 2000: {
   gross: L1
   net: L1
   feeGrowthOutside0: 0
   feeGrowthOutside1: 0
}
TICK -> 2500: {
   gross: L2
   net: L2
   feeGrowthOutside0: 0
   feeGrowthOutside1: 0
}
TICK -> 3000: {
   gross: L1
   net: -L1
   feeGrowthOutside0: 0
   feeGrowthOutside1: 0
}
TICK -> 3500: {
   gross: L2
   net: -L2
   feeGrowthOutside0: 0
   feeGrowthOutside1: 0
}
在初始化position的时候，
假设当前price为2700，这时的流动性为L1+L2
在初始化position的时候，2000和2500位置的tick，feeOutside为global，3000和3500的feeOutside为0
1. 经过了swap之后，price变为了2900
   1for0，累积的手续费为token1
   feeGrowthGlobal为G
   这时我们对L1的position进行更新

对于不同端点，比较它们的feeOut没有意义，只有用给定区间内feeOut和feeGlobal的增量算出的手续费才有意义



### seconds 
为外部合约提供便利，计算给定的position已经激活了多长时间
为了实现这个目的，我们也需要构建类似fee的数据结构，通过比较端点与currentTick的关系找到激活的一侧，再计算出position above 和 below的值，就可以算出position内的激活累计时间

secondsOutside -> tick的属性，在tick的另一边已经花费的时间

### oracle
除了价格的累积值记录之外还提供了交易对深度的累积值，帮助开发者判断此交易对预言机被攻击的难易程度
oracle默认还是储存一个最近价格的时间累积值，不过可以根据需求由开发者对数量进行拓展，最多拓展到65535个价格
oracle实际记录tick的时间累积值
#### 几个库函数
##### transform(last, blockTImestamp, tick, liquidity) -> Observation
对observation数组中的一个observation进行更新
这里secondsPerLiquidityCumulative的更新方式是，将delta扩展到Q128.128格式，然后除以流动性，如果没有流动性的话，默认是每秒+1

##### initialize(self, time) -> (cardinality, cardinalityNext)
对observation数组进行初始化

##### write(self, index, blockTimestamp, tick, liquidity, cardinality, cardinalityNext) -> (indexUpdated, cardinalityUpdated)
进行一些前置判断和运算，之后调用transform, 对observation数组中的一个observation进行更新
```solidity
indexUpdated = (index + 1) % cardinalityUpdated;
```
数组可用大小写满之后，会从0开始写入

##### grow(self, current, next) -> uint16
对数组做一些准备，以更新数组长度

假设我们TWAP的时间窗口为1h，
   eth mainnet主网出块时间为12s，一个小时可以出300个块，也就是说我们需要扩容的容量最大也不过300个
   blast mainnet主网出块时间为2s，一个小时可以出1800个块，这时就需要有选择性地选取时间戳了

计算加权平均的tick公式为：
averageTick = (tickCumulative[1] - tickCumulative[0]) / (time1 - time0)
得到averageTick之后，通过getSqrtRatioAtTick()将其转化为sqrtPriceX96.
需要注意的是，这里的价格并不是真实的TWAP，因为我们为了便于存储和计算，选择存储离散的tick的TWAP，而连续的price和离散的tick是有一些差距的。不过因为每个tick所对应的价格只差 0.01%， 所以我们将其忽略不计
下面是计算最近一小时的TWAP的代码
```solidity
function getSqrtTWAP(address poolAddress) external view returns (uint160 sqrtPriceX96) {
   IUniswapV3Pool pool = IUniswapV3Pool(poolAddress);
   uint32[] memory secondsAgos = new uint32[](2);
   secondsAgos[0] = 3600;
   secondsAgos[1] = 0;
   (int56[] memory tickCumulatives, ) = pool.observe(secondsAgos);
   int56 averageTick = (tickCumulatives[1] - tickCumulatives[0]) / 3600;
   sqrtPriceX96 = TickMath.getSqrtRatioAtTick(averageTick);
}
```
这个代码大部分情况是可行的，但是有一种情况不可行，那就是碰到池子还没有初始化1h，
这个时候我们就需要对代码进行优化，将计算TWAP的开始时间设置为observations数组中离当前时间最久的那个observation。
当前的索引为index，精确的下一个索引值应该为(index+1) % cardinality
对代码进行优化：
```solidity
function getSqrtTWAP(address poolAddress, uint32 twapInterval) external view returns (uint160 sqrtPriceX96) {
   IUniswapV3Pool pool = IUniswapV3Pool(poolAddress);
   (,,uint16 index, uint16 cardinality,,,) = pool.slot0();
   (uint32 targetElementTime,,, bool initialized) = pool.observations((index+1)%cardinality);
   // 如果下一个元素没有被初始化，将其改为第一个元素
   if(!initialized) (targetElementTime,,,) = pool.observations(0);
   uint32 delta = uint32(block.timestamp) - targetElementTime;
   if(delta == 0) (sqrtPriceX96,,,,,,) = pool.slot0();
   else {
      // 如果这个最大的时间间隔小于我们的设定，采用它
      if(delta < twapInterval) twapInterval = delta;
      uint32[] memory secondsAgos = new uint32[](2);
      secondsAgos[0] = twapInterval;;
      secondsAgos[1] = 0;
      (int56 memory tickCumulatives,) = pool.observe(secondsAgos);
      sqrtPriceX96 = TickMath.getSqrtPriceRatioAtTick(int24(tickCumulatives[1] - tickCumulatives[0] / int56(uint56(twapInterval))));
   }
}
```