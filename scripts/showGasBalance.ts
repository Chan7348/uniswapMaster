import { ethers } from "hardhat";
import { BigNumberish } from "ethers";
async function main(): Promise<void> {
    const address: string = "0x392cc13567C68C4902fe67A1c6Ba6743FE2Fd8eB";
    
    // 修正：直接使用 ethers 获取当前的 provider
    const provider = ethers.provider;
    
    // 使用提供者(provider)获取指定地址的余额
    const balance = await provider.getBalance(address);
    
    // 将余额从wei转换为ether
    const balanceInEther = ethers.formatEther(balance.toString());
    
    console.log(`地址 ${address} 的余额是: ${balanceInEther} ETH`);
}
    
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
    