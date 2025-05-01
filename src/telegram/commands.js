// src/telegram/commands.js
const TrackedWallet = require("../db/models/trackedWallets");
const Chain = require("../db/models/chains");
const BotConfig = require("../db/models/botConfig");
const { getEvmBalance } = require("../services/wallets/evm");
const { getSolanaBalance } = require("../services/wallets/solana");
const { formatBotStatus, formatWalletBalance } = require("./messages");

// Helper to store chat ID in database
const storeChatId = async (chatId) => {
  try {
    // Check if we already have a chatId stored
    let chatIdConfig = await BotConfig.findOne({ setting: "chatId" });

    if (!chatIdConfig) {
      // Create new config if it doesn't exist
      chatIdConfig = new BotConfig({
        setting: "chatId",
        value: chatId.toString(),
        description: "Primary chat ID for bot notifications",
      });
      console.log(`Storing new chat ID: ${chatId}`);
    } else {
      // Update existing config
      chatIdConfig.value = chatId.toString();
      console.log(`Updating chat ID to: ${chatId}`);
    }

    await chatIdConfig.save();
    return true;
  } catch (error) {
    console.error("Error storing chat ID:", error);
    return false;
  }
};

// Command handlers
module.exports = {
  start: async (bot, msg) => {
    const chatId = msg.chat.id;

    // Store chat ID for notifications
    await storeChatId(chatId);

    const message = `
👋 *Welcome to the Telegram Copy Trading Bot!*

This bot allows you to track wallets on various blockchains and automatically copy their swaps.

Use /help to see available commands.
    `;

    bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
  },

  help: async (bot, msg) => {
    const chatId = msg.chat.id;

    // Store chat ID for notifications
    await storeChatId(chatId);

    const message = `
*Available Commands:*


/add <address> <chain> - Add a wallet to track
/remove <address> <chain> - Remove a tracked wallet
/list - List all tracked wallets
/balance <chain> - Check your wallet balance on a chain
/status - Check bot status
/start - Initialize the bot
/help - Show this help message

Example: /add 0x123...abc eth
    `;

    bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
  },

  addWallet: async (bot, msg, match) => {
    const chatId = msg.chat.id;

    // Store chat ID for notifications
    // await storeChatId(chatId);

    try {
      const params = match[1].trim().split(" ");

      if (params.length < 2) {
        return bot.sendMessage(
          chatId,
          "⚠️ Invalid format. Use: /add <address> <chain>"
        );
      }

      const address = params[0];
      const chainId = params[1].toLowerCase();

      // Validate chain
      const chain = await Chain.findOne({ chainId });
      if (!chain) {
        return bot.sendMessage(
          chatId,
          `⚠️ Chain '${chainId}' not supported. Use /list chains to see supported chains.`
        );
      }

      // Check if wallet already exists
      const existingWallet = await TrackedWallet.findOne({
        address,
        chain: chainId,
      });
      if (existingWallet) {
        if (existingWallet.isActive) {
          return bot.sendMessage(
            chatId,
            `⚠️ Wallet ${address} on ${chainId} is already being tracked.`
          );
        } else {
          // Reactivate the wallet
          existingWallet.isActive = true;
          await existingWallet.save();
          return bot.sendMessage(
            chatId,
            `✅ Wallet ${address} on ${chainId} has been reactivated.`
          );
        }
      }

      // Create new tracked wallet
      const newWallet = new TrackedWallet({
        address,
        chain: chainId,
        isActive: true,
      });

      await newWallet.save();

      bot.sendMessage(
        chatId,
        `✅ Now tracking wallet ${address} on ${chainId}.`
      );
    } catch (error) {
      console.error("Error adding wallet:", error);
      bot.sendMessage(chatId, `❌ Error adding wallet: ${error.message}`);
    }
  },

  removeWallet: async (bot, msg, match) => {
    const chatId = msg.chat.id;

    // Store chat ID for notifications
    // await storeChatId(chatId);

    try {
      const params = match[1].trim().split(" ");

      if (params.length < 2) {
        return bot.sendMessage(
          chatId,
          "⚠️ Invalid format. Use: /remove <address> <chain>"
        );
      }

      const address = params[0];
      const chainId = params[1].toLowerCase();

      // Find the wallet
      const wallet = await TrackedWallet.findOne({ address, chain: chainId });

      if (!wallet) {
        return bot.sendMessage(
          chatId,
          `⚠️ Wallet ${address} on ${chainId} is not being tracked.`
        );
      }

      // Deactivate the wallet (soft delete)
      wallet.isActive = false;
      await wallet.save();

      bot.sendMessage(
        chatId,
        `✅ Stopped tracking wallet ${address} on ${chainId}.`
      );
    } catch (error) {
      console.error("Error removing wallet:", error);
      bot.sendMessage(chatId, `❌ Error removing wallet: ${error.message}`);
    }
  },

  listWallets: async (bot, msg) => {
    const chatId = msg.chat.id;

    // Store chat ID for notifications
    // await storeChatId(chatId);

    try {
      // Get all tracked wallets
      const wallets = await TrackedWallet.find().sort({ chain: 1 });

      // Get all chains for reference
      const chains = await Chain.find();

      // Format message
      const message = formatWalletList(wallets, chains);

      bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
    } catch (error) {
      console.error("Error listing wallets:", error);
      bot.sendMessage(chatId, `❌ Error listing wallets: ${error.message}`);
    }
  },

  status: async (bot, msg) => {
    const chatId = msg.chat.id;

    // Store chat ID for notifications
    // await storeChatId(chatId);

    try {
      // Get bot status
      const botStatusConfig = await BotConfig.findOne({ setting: "botStatus" });
      const botStatus = botStatusConfig ? botStatusConfig.value : "stopped";

      // Count chains
      const chainCount = await Chain.countDocuments();
      const activeChainCount = await Chain.countDocuments({ isActive: true });

      // Count wallets
      const walletCount = await TrackedWallet.countDocuments();
      const activeWalletCount = await TrackedWallet.countDocuments({
        isActive: true,
      });

      // Count swaps
      const Swap = require("../db/models/swaps");
      const processedSwapCount = await Swap.countDocuments({ processed: true });
      const pendingSwapCount = await Swap.countDocuments({
        processed: false,
        "status.code": "pending",
      });
      const failedSwapCount = await Swap.countDocuments({
        "status.code": "failed",
      });

      // Format status message
      const statusData = {
        botStatus,
        chainCount,
        activeChainCount,
        walletCount,
        activeWalletCount,
        processedSwapCount,
        pendingSwapCount,
        failedSwapCount,
      };

      const message = formatBotStatus(statusData);

      bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
    } catch (error) {
      console.error("Error getting status:", error);
      bot.sendMessage(chatId, `❌ Error getting status: ${error.message}`);
    }
  },

  balance: async (bot, msg, match) => {
    const chatId = msg.chat.id;

    // Store chat ID for notifications
    // await storeChatId(chatId);

    const chainId = match[1].trim().toLowerCase();

    try {
      const chain = await Chain.findOne({ chainId });

      if (!chain) {
        return bot.sendMessage(
          chatId,
          `⚠️ Chain '${chainId}' not supported. Use /list chains to see supported chains.`
        );
      }

      let balance;

      if (chain.type === "evm") {
        balance = await getEvmBalance(chain);
      } else if (chain.type === "solana") {
        balance = await getSolanaBalance();
      } else {
        return bot.sendMessage(
          chatId,
          `⚠️ Unsupported chain type: ${chain.type}`
        );
      }

      // Format balance message
      const message = formatWalletBalance(balance, chain);

      bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
    } catch (error) {
      console.error("Error getting balance:", error);
      bot.sendMessage(chatId, `❌ Error getting balance: ${error.message}`);
    }
  },
};

const formatWalletList = (wallets, chains) => {
  if (wallets.length === 0) {
    return "📝 You're not tracking any wallets yet. Use /add to start tracking a wallet.";
  }

  // Group wallets by chain
  const walletsByChain = {};

  wallets.forEach((wallet) => {
    if (!walletsByChain[wallet.chain]) {
      walletsByChain[wallet.chain] = [];
    }
    walletsByChain[wallet.chain].push(wallet);
  });

  let message = "📋 *Currently Tracked Wallets:*\n\n";

  for (const chain in walletsByChain) {
    const chainInfo = chains.find((c) => c.chainId === chain);
    message += `*${chainInfo ? chainInfo.name : chain}:*\n`;

    walletsByChain[chain].forEach((wallet) => {
      const label = wallet.label ? ` (${wallet.label})` : "";
      message += `- \`${wallet.address}\`${label}\n`;
    });

    message += "\n";
  }

  return message;
};
