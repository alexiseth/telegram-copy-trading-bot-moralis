// src/services/execution/inchSwap.js
const axios = require("axios");
const { ethers } = require("ethers");
const { getEvmWallet, getEvmProvider } = require("../wallets/evm");
require("dotenv").config();

// ERC20 token approval ABI
const erc20ApprovalAbi = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

// Native token addresses for EVM chains
const NATIVE_TOKEN_ADDRESSES = {
  eth: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  base: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", // 1inch format for all native tokens
  polygon: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  arbitrum: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  optimism: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  avalanche: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
};

// Chain-specific native token addresses (actual blockchain addresses)
const CHAIN_NATIVE_TOKENS = {
  eth: "0x0000000000000000000000000000000000000000",
  base: "0x4200000000000000000000000000000000000006",
  polygon: "0x0000000000000000000000000000000000001010",
  arbitrum: "0x912CE59144191C1204E64559FE8253a0e49E6548",
  optimism: "0x4200000000000000000000000000000000000006",
  avalanche: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
};

// Execute a swap using 1inch for EVM chains
const executeInchSwap = async (swap, chain) => {
  try {
    console.log(
      `Executing 1inch swap on ${chain.name} for tx: ${swap.sourceTxHash}`
    );

    const wallet = getEvmWallet(chain);
    const provider = getEvmProvider(chain);
    const walletAddress = wallet.address;

    // Determine which token is being swapped from
    const fromToken = swap.tokenIn;
    const toToken = swap.tokenOut;

    // Check if fromToken is a native token
    const isFromNative = isNativeToken(fromToken.address, chain.chainId);

    // Handle native token special address format for 1inch
    const INCH_NATIVE_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

    const fromTokenAddress = isFromNative
      ? INCH_NATIVE_TOKEN
      : fromToken.address;
    const toTokenAddress = isNativeToken(toToken.address, chain.chainId)
      ? INCH_NATIVE_TOKEN
      : toToken.address;

    // Check if we have sufficient balance before proceeding
    let hasBalance = false;
    let actualBalance = "0";

    try {
      if (isFromNative) {
        // Check native token balance
        const balance = await provider.getBalance(walletAddress);
        const requiredAmount = ethers.utils.parseUnits(
          fromToken.amount.toString(),
          fromToken.decimals
        );
        actualBalance = ethers.utils.formatUnits(balance, fromToken.decimals);

        hasBalance = balance.gte(requiredAmount);
      } else {
        // Check ERC20 token balance
        if (!ethers.utils.isAddress(fromToken.address)) {
          throw new Error(`Invalid token address format: ${fromToken.address}`);
        }

        const tokenContract = new ethers.Contract(
          fromToken.address,
          erc20ApprovalAbi,
          provider
        );

        // Verify we can interact with the token contract
        try {
          const symbol = await tokenContract.symbol();
        } catch (e) {
          throw new Error(
            `Cannot interact with token at ${fromToken.address}: ${e.message}`
          );
        }

        const balance = await tokenContract.balanceOf(walletAddress);
        const requiredAmount = ethers.utils.parseUnits(
          fromToken.amount.toString(),
          fromToken.decimals
        );
        actualBalance = ethers.utils.formatUnits(balance, fromToken.decimals);

        hasBalance = balance.gte(requiredAmount);
      }
    } catch (balanceError) {
      throw new Error(`Failed to check balance: ${balanceError.message}`);
    }

    if (!hasBalance) {
      throw new Error(
        `Insufficient balance to execute swap. You have ${actualBalance} ${fromToken.symbol} but need ${fromToken.amount} ${fromToken.symbol}`
      );
    }

    // Parse the amount with correct decimals
    const amount = ethers.utils
      .parseUnits(fromToken.amount.toString(), fromToken.decimals)
      .toString();

    // Check and approve token allowance if needed (skip for native tokens)
    if (!isFromNative) {
      try {
        await checkAndApproveAllowance(
          wallet,
          fromToken.address,
          "0x1111111254eeb25477b68fb85ed929f73a960582", // 1inch router address
          amount,
          fromToken.decimals
        );
      } catch (approvalError) {
        throw new Error(`Failed to approve token: ${approvalError.message}`);
      }
    }

    // Get chain ID for 1inch
    const inchChainId = getInchChainId(chain.chainId);
    if (!inchChainId) {
      throw new Error(`Chain ${chain.chainId} not supported by 1inch`);
    }

    // Build the 1inch API URL
    const apiUrl = `https://api.1inch.dev/swap/v5.2/${inchChainId}/swap`;

    // Create the swap parameters
    const swapParams = {
      src: fromTokenAddress,
      dst: toTokenAddress,
      amount: amount,
      from: walletAddress,
      slippage: 1, // 1% slippage
      disableEstimate: false,
    };

    // Make the API request to 1inch
    const headers = {
      Authorization: `Bearer ${process.env.INCH_API_KEY}`,
      "Content-Type": "application/json",
    };

    const swapResponse = await axios.get(apiUrl, {
      headers,
      params: swapParams,
    });

    const swapData = swapResponse.data;

    if (!swapData || !swapData.tx) {
      throw new Error("Invalid swap data received from 1inch");
    }

    // Execute the transaction
    const tx = {
      from: walletAddress,
      to: swapData.tx.to,
      data: swapData.tx.data,
      value: swapData.tx.value,
      gasPrice: swapData.tx.gasPrice,
      gasLimit: Math.floor(swapData.tx.gas * 1.2), // Add 20% buffer to gas limit
    };

    // Sign and send the transaction without waiting for confirmation
    const txResponse = await wallet.sendTransaction(tx);
    console.log(`Transaction sent! Hash: ${txResponse.hash}`);

    // Return success without waiting for confirmation
    return {
      success: true,
      txHash: txResponse.hash,
      // We don't have blockNumber yet since we're not waiting for confirmation
      message: "Transaction submitted to the network",
    };
  } catch (error) {
    console.error("Error executing 1inch swap:", error);
    return {
      success: false,
      error: error.message || "Unknown error during swap execution",
    };
  }
};

// Helper function to check if a token is a native token
function isNativeToken(tokenAddress, chainId) {
  // First check the standard native address
  if (tokenAddress === "0x0000000000000000000000000000000000000000") {
    return true;
  }

  // Then check chain-specific native addresses
  const chainNativeAddress = CHAIN_NATIVE_TOKENS[chainId];
  if (
    chainNativeAddress &&
    tokenAddress.toLowerCase() === chainNativeAddress.toLowerCase()
  ) {
    return true;
  }

  // Check 1inch format
  if (tokenAddress === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE") {
    return true;
  }

  return false;
}

// Helper function to check token allowance and approve if needed
async function checkAndApproveAllowance(
  wallet,
  tokenAddress,
  spenderAddress,
  amount,
  decimals
) {
  // Validate token address
  if (!ethers.utils.isAddress(tokenAddress)) {
    throw new Error(`Invalid token address format: ${tokenAddress}`);
  }

  // Skip zero address or native token addresses
  if (
    tokenAddress === "0x0000000000000000000000000000000000000000" ||
    tokenAddress === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
  ) {
    throw new Error(
      `Cannot approve native token or zero address: ${tokenAddress}`
    );
  }

  try {
    // Create contract instance
    const tokenContract = new ethers.Contract(
      tokenAddress,
      erc20ApprovalAbi,
      wallet
    );

    // First, verify we can interact with this contract
    try {
      const symbol = await tokenContract.symbol();
    } catch (e) {
      throw new Error(`Cannot interact with token at ${tokenAddress}`);
    }

    // Get current allowance
    const currentAllowance = await tokenContract.allowance(
      wallet.address,
      spenderAddress
    );

    // If allowance is insufficient, approve
    if (currentAllowance.lt(ethers.BigNumber.from(amount))) {
      const approveTx = await tokenContract.approve(
        spenderAddress,
        ethers.constants.MaxUint256 // Infinite approval
      );

      // Wait for approval transaction to be mined
      // We DO wait for approval confirmations since this needs to complete before the swap
      await approveTx.wait(1);
    }

    return true;
  } catch (error) {
    throw error; // Re-throw for proper handling
  }
}

// Helper function to get the correct chain ID for 1inch API
function getInchChainId(chainId) {
  const chainMap = {
    eth: 1,
    polygon: 137,
    optimism: 10,
    arbitrum: 42161,
    avalanche: 43114,
    base: 8453,
  };

  return chainMap[chainId];
}

module.exports = {
  executeInchSwap,
};
