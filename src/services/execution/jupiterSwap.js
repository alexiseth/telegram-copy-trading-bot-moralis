// src/services/execution/jupiterSwap.js
const axios = require("axios");
const {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
} = require("@solana/web3.js");
const { getSolanaConnection, getSolanaWallet } = require("../wallets/solana");
const base58 = require("base-58");
require("dotenv").config();

// Execute a swap using Jupiter for Solana
const executeJupiterSwap = async (swap) => {
  try {
    console.log(
      `Executing Jupiter swap on Solana for tx: ${swap.sourceTxHash}`
    );

    const connection = getSolanaConnection();
    const wallet = getSolanaWallet();
    const userPublicKey = wallet.publicKey.toString();

    // Get input and output tokens
    const fromToken = swap.tokenIn;
    const toToken = swap.tokenOut;

    console.log(
      `Swapping ${fromToken.amount} ${fromToken.symbol} to ${toToken.symbol}`
    );

    // Check if the token addresses are valid
    if (!fromToken.address || !toToken.address) {
      throw new Error(
        `Invalid token addresses: ${fromToken.address} -> ${toToken.address}`
      );
    }

    // Convert amount to the correct format (with decimals)
    const inputAmount = Math.floor(
      parseFloat(fromToken.amount) * Math.pow(10, fromToken.decimals)
    );
    if (isNaN(inputAmount) || inputAmount <= 0) {
      throw new Error(`Invalid amount: ${fromToken.amount}`);
    }

    // Use Jupiter V6 API
    console.log(`Fetching order from Jupiter Ultra API...`);

    try {
      // 1. Get a quote first
      const quoteResponse = await axios.get(
        "https://quote-api.jup.ag/v6/quote",
        {
          params: {
            inputMint: fromToken.address,
            outputMint: toToken.address,
            amount: inputAmount.toString(),
            slippageBps: 100, // 1% slippage
          },
        }
      );

      const quoteData = quoteResponse.data;

      if (!quoteData || !quoteData.outAmount) {
        throw new Error("Invalid quote response from Jupiter");
      }

      const expectedOutput =
        parseFloat(quoteData.outAmount) / Math.pow(10, toToken.decimals);
      console.log(
        `Order received. Expected output: ${expectedOutput} ${toToken.symbol}`
      );

      // 2. Now submit the swap transaction
      console.log(`Submitting transaction to Jupiter Ultra API...`);
      const swapResponse = await axios.post(
        "https://quote-api.jup.ag/v6/swap",
        {
          quoteResponse: quoteData,
          userPublicKey: wallet.publicKey.toString(),
          wrapAndUnwrapSol: true, // Automatically wrap/unwrap SOL
        }
      );

      if (!swapResponse.data || !swapResponse.data.swapTransaction) {
        throw new Error("Invalid swap response from Jupiter");
      }

      // 3. Decode and sign the transaction
      const swapTransactionBuf = Buffer.from(
        swapResponse.data.swapTransaction,
        "base64"
      );

      // Check if it's a versioned transaction (newer) or legacy transaction
      let transaction;
      try {
        transaction = VersionedTransaction.deserialize(swapTransactionBuf);
        console.log("Using Versioned Transaction");
      } catch (err) {
        // If not a versioned transaction, try legacy format
        transaction = Transaction.from(swapTransactionBuf);
        console.log("Using Legacy Transaction");
      }

      // Sign the transaction - different process for versioned vs legacy transactions
      let signedTransaction;
      if (transaction instanceof VersionedTransaction) {
        transaction.sign([wallet]);
        signedTransaction = transaction;
      } else {
        // Legacy transaction
        transaction.partialSign(wallet);
        signedTransaction = transaction;
      }

      // 4. Send the transaction
      let serializedTransaction;
      if (signedTransaction instanceof VersionedTransaction) {
        serializedTransaction = signedTransaction.serialize();
      } else {
        serializedTransaction = signedTransaction.serialize();
      }

      const signature = await connection.sendRawTransaction(
        serializedTransaction,
        {
          skipPreflight: false,
          preflightCommitment: "confirmed",
        }
      );

      console.log(`Transaction sent! Signature: ${signature}`);

      return {
        success: true,
        txHash: signature,
        message: `Transaction sent with expected output of ${expectedOutput} ${toToken.symbol}`,
      };
    } catch (apiError) {
      console.error(
        "Jupiter API error:",
        apiError.response?.data || apiError.message
      );
      throw new Error(
        `Jupiter API error: ${
          apiError.response?.data?.error || apiError.message
        }`
      );
    }
  } catch (error) {
    console.error("Error executing Jupiter swap:", error);
    return {
      success: false,
      error: error.message || "Jupiter swap failed without specific error",
    };
  }
};

module.exports = {
  executeJupiterSwap,
};
