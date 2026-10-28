const { ethers } = require("ethers");

async function main() {
  const rpcUrl = "https://api.tokenx-nonprod.com/rpc/v1";
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const investmentTokenAddress = "0xE65Cab379F91F88950F342760c1695462868bC5D";
  const callerAddress = "0x3859F5aCe0BfD71ca8ceb9a1860C6072d9cb8938";
  const spenderAddress = "0xD9AeB1b00Ec5370f3BBcb8F729450f95DcF589c8";

  console.log("Checking allowlist status...");
  console.log(`Investment Token: ${investmentTokenAddress}`);
  
  const tokenAbi = [
    "function allowlistRegistry() view returns (address)"
  ];
  const tokenContract = new ethers.Contract(investmentTokenAddress, tokenAbi, provider);

  try {
    const registryAddress = await tokenContract.allowlistRegistry();
    console.log(`Allowlist Registry: ${registryAddress}`);

    const registryAbi = [
      "function isAllowlist(address) view returns (bool)"
    ];
    const registryContract = new ethers.Contract(registryAddress, registryAbi, provider);

    // Proxy-specific ABI
    const proxyAbi = [
      "function version() view returns (string)",
      "function totalRegistry() view returns (uint256)"
    ];
    const proxyContract = new ethers.Contract(registryAddress, proxyAbi, provider);

    let isProxy = false;
    let version = "N/A";
    try {
      version = await proxyContract.version();
      isProxy = true;
    } catch (e) {
      // Not a proxy or doesn't have version()
    }

    const isCallerAllowlisted = await registryContract.isAllowlist(callerAddress);
    const isSpenderAllowlisted = await registryContract.isAllowlist(spenderAddress);

    console.log(`Registry address: ${registryAddress}`);
    console.log(`Is Registry Proxy: ${isProxy} (Version: ${version})`);
    console.log(`Caller (${callerAddress}) is allowlisted: ${isCallerAllowlisted}`);
  } catch (err) {
    console.error("Error fetching data:", err);
  }
}

main();
