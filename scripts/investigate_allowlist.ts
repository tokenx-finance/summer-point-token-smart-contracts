import { ethers } from "hardhat";

async function main() {
  const rpcUrl = "http://api.tokenx-nonprod.com/rpc/v1";
  // In ethers v6, JsonRpcProvider might attempt to detect network.
  // If it fails due to custom chain, we might need to pass network info or use StaticJsonRpcProvider equivalent if available,
  // but usually JsonRpcProvider is fine.
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const investmentTokenAddress = "0xE65Cab379F91F88950F342760c1695462868bC5D";
  const callerAddress = "0x3859F5aCe0BfD71ca8ceb9a1860C6072d9cb8938";
  const spenderAddress = "0xD9AeB1b00Ec5370f3BBcb8F729450f95DcF589c8";

  console.log("Checking allowlist status...");
  console.log(`Investment Token: ${investmentTokenAddress}`);
  
  // ABI to get registry
  const tokenAbi = [
    "function allowlistRegistry() view returns (address)"
  ];
  const tokenContract = new ethers.Contract(investmentTokenAddress, tokenAbi, provider);

  try {
    const registryAddress = await tokenContract.allowlistRegistry();
    console.log(`Allowlist Registry: ${registryAddress}`);

    // ABI to check allowlist
    const registryAbi = [
      "function isAllowlist(address) view returns (bool)"
    ];
    const registryContract = new ethers.Contract(registryAddress, registryAbi, provider);

    const isCallerAllowlisted = await registryContract.isAllowlist(callerAddress);
    const isSpenderAllowlisted = await registryContract.isAllowlist(spenderAddress);

    console.log(`Caller (${callerAddress}) is allowlisted: ${isCallerAllowlisted}`);
    console.log(`Spender (${spenderAddress}) is allowlisted: ${isSpenderAllowlisted}`);
  } catch (err) {
    console.error("Error fetching data:", err);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
