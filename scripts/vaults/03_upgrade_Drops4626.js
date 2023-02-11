const hre = require("hardhat");

async function main() {
  const { ethers, upgrades } = hre;

  // const beacon = await deployments.get("Drops4626");
  // const Drops4626 = await ethers.getContractFactory("Drops4626");
  // const vault = await upgrades.upgradeBeacon(beacon.address, Drops4626, {'timeout': 0});
  // await vault.deployed();
// 
  // console.log(`Drops4626 successfully upgraded to ${vault.address}!`);

  if (hre.network.name !== "localhost" && hre.network.name !== "hardhat") {
    try {
      await hre.run("verify:verify", {
        address: "0xDFf540f3922d53544aEBa4D0Aec0f0c42c706904",
        contract: "contracts/vaults/Drops4626.sol:Drops4626",
        constructorArguments: [],
      });
    } catch (_) {}
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
