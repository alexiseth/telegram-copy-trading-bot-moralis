// src/services/wallets/solana.js
const { Connection, PublicKey, Keypair } = require("@solana/web3.js");
const base58 = require("base-58"); // Using base-58 package instead of bs58
const axios = require("axios");
require("dotenv").config();

// Create a Solana wallet from private key
const getSolanaWallet = () => {
  try {
    // Get private key from env (should be base58 encoded string)
    const privateKeyString = process.env.SOLANA_PRIVATE_KEY;

    if (!privateKeyString) {
      throw new Error("SOLANA_PRIVATE_KEY not found in environment variables");
    }

    // Convert base58 private key to Uint8Array
    const privateKeyBytes = base58.decode(privateKeyString);

    // Create keypair from private key
    const keypair = Keypair.fromSecretKey(Buffer.from(privateKeyBytes));

    return keypair;
  } catch (error) {
    console.error("Error creating Solana wallet:", error);
    throw new Error(`Failed to initialize Solana wallet: ${error.message}`);
  }
};

// Create a Solana connection
const getSolanaConnection = () => {
  try {
    const rpcUrl =
      process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
    return new Connection(rpcUrl);
  } catch (error) {
    console.error("Error creating Solana connection:", error);
    throw new Error(`Failed to initialize Solana connection: ${error.message}`);
  }
};

// Get portfolio data using Moralis API
const getSolanaPortfolio = async (walletAddress) => {
  try {
    const apiKey = process.env.MORALIS_API_KEY;
    if (!apiKey) {
      throw new Error("MORALIS_API_KEY not found in environment variables");
    }

    const url = `https://solana-gateway.moralis.io/account/mainnet/${walletAddress}/portfolio?nftMetadata=false`;

    const response = await axios.get(url, {
      headers: {
        accept: "application/json",
        "X-API-Key": apiKey,
      },
    });

    return response.data;
  } catch (error) {
    console.error("Error fetching Solana portfolio from Moralis:", error);
    throw new Error(
      `Failed to fetch Solana portfolio: ${
        error.response?.data?.message || error.message
      }`
    );
  }
};

// Get balance of Solana wallet including tokens
const getSolanaBalance = async () => {
  try {
    const wallet = getSolanaWallet();
    const walletAddress = wallet.publicKey.toString();

    // Get portfolio data from Moralis (includes both SOL and tokens)
    const portfolio = await getSolanaPortfolio(walletAddress);

    // Format native SOL balance
    const solAmount = parseFloat(portfolio.nativeBalance.solana);

    // Format token balances
    const formattedTokens = [];

    if (portfolio.tokens && portfolio.tokens.length > 0) {
      for (const token of portfolio.tokens) {
        formattedTokens.push({
          symbol: token.symbol,
          name: token.name || token.symbol,
          amount: token.amount,
          decimals: token.decimals,
          address: token.mint,
        });
      }
    }

    // Format response
    const response = {
      address: walletAddress,
      native: {
        symbol: "SOL",
        name: "Solana",
        amount: solAmount.toString(),
        decimals: 9,
      },
      tokens: formattedTokens,
    };

    console.log(`SOL balance: ${solAmount} SOL`);
    if (formattedTokens.length > 0) {
      console.log(`Found ${formattedTokens.length} tokens in wallet`);
    }

    return response;
  } catch (error) {
    console.error("Error getting Solana balance:", error);
    throw error;
  }
};

module.exports = {
  getSolanaWallet,
  getSolanaConnection,
  getSolanaBalance,
};
