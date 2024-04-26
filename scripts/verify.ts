const hre = require("hardhat");

async function main() {
  await hre.run("verify:verify", {
    address: "0xbB2D16E19D873A315CCDD90DF3E6255ddc0D2d6e",
    constructorArguments: [
      ["0x4Ba577aF05692b81Dc3C916c765C843308Beaa7B", "0xbB3AF9dB7480ed8f0F296E2395ec794f23F8c748"],
      2
    ],
    network: "arbitrum_sepolia",
  });
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
