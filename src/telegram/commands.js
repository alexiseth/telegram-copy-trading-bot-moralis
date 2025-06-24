// src/telegram/commands.js
const TrackedWallet = require("../db/models/trackedWallets");
const Chain = require("../db/models/chains");
const BotConfig = require("../db/models/botConfig");
const { getEvmBalance } = require("../services/wallets/evm");
const { getSolanaBalance } = require("../services/wallets/solana");
const { formatBotStatus, formatWalletBalance } = require("./messages");
const { getEvmTransactions, getSolanaTransactions, formatTransactionList } = require("../services/moralis/transactions");
const { cache } = require("../utils/cache");

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

Use the menu below to interact with the bot:
    `;

    const menuKeyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "📝 Add Wallet", callback_data: "menu_add" },
            { text: "🗑️ Remove Wallet", callback_data: "menu_remove" }
          ],
          [
            { text: "📋 List Wallets", callback_data: "menu_list" },
            { text: "📊 Check Status", callback_data: "menu_status" }
          ],
          [
            { text: "💰 Check Balance", callback_data: "menu_balance" },
            { text: "🔍 Transactions", callback_data: "menu_transactions" }
          ],
          [
            { text: "❓ Help", callback_data: "menu_help" },
            { text: "🔄 Show Menu", callback_data: "menu_main" }
          ]
        ]
      }
    };

    bot.sendMessage(chatId, message, { 
      parse_mode: "Markdown",
      ...menuKeyboard
    });
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
/transactions <address> <chain> - Check recent transactions
/status - Check bot status
/start - Initialize the bot
/help - Show this help message

*Supported chains:* eth, base, polygon, solana

*Examples:* 
/add 0x123...abc eth
/transactions 0x123...abc eth
    `;

    const menuKeyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🔄 Back to Main Menu", callback_data: "menu_main" }
          ]
        ]
      }
    };

    bot.sendMessage(chatId, message, { 
      parse_mode: "Markdown",
      ...menuKeyboard
    });
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
    console.log(`Status command called for chat ${chatId}`);

    try {
      // Simple status response for now
      const statusMessage = `*BOT STATUS*: 🟢 RUNNING

📊 *Quick Status*
✅ Bot is online and responding
⚡ Optimizations active
🔄 Processing requests

Use /help to see available commands`;
      
      console.log('Sending status response...');
      bot.sendMessage(chatId, statusMessage, { parse_mode: "Markdown" });
      return;

      // Get bot status (run queries in parallel for speed)
      const [
        botStatusConfig,
        chainCount,
        activeChainCount,
        walletCount,
        activeWalletCount,
        processedSwapCount,
        pendingSwapCount,
        failedSwapCount
      ] = await Promise.all([
        BotConfig.findOne({ setting: "botStatus" }),
        Chain.countDocuments(),
        Chain.countDocuments({ isActive: true }),
        TrackedWallet.countDocuments(),
        TrackedWallet.countDocuments({ isActive: true }),
        (async () => {
          try {
            const Swap = require("../db/models/swaps");
            return await Swap.countDocuments({ processed: true });
          } catch (e) { return 0; }
        })(),
        (async () => {
          try {
            const Swap = require("../db/models/swaps");
            return await Swap.countDocuments({
              processed: false,
              "status.code": "pending",
            });
          } catch (e) { return 0; }
        })(),
        (async () => {
          try {
            const Swap = require("../db/models/swaps");
            return await Swap.countDocuments({
              "status.code": "failed",
            });
          } catch (e) { return 0; }
        })()
      ]);

      const botStatus = botStatusConfig ? botStatusConfig.value : "stopped";

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
      
      // Cache status for 15 seconds for ultra-fast subsequent requests
      cache.set(statusCacheKey, message, 15000);

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

  setChatId: async (bot, msg) => {
    const chatId = msg.chat.id;

    // Store chat ID for notifications
    await storeChatId(chatId);

    bot.sendMessage(
      chatId,
      `✅ Chat ID has been set to: ${chatId}\nBot will send notifications to this chat.`
    );
  },

  transactions: async (bot, msg, match) => {
    const chatId = msg.chat.id;

    try {
      const params = match[1].trim().split(" ");
      
      if (params.length < 2) {
        return bot.sendMessage(
          chatId,
          "⚠️ Invalid format. Use: /transactions <wallet_address> <chain>\n\nExample: /transactions 0x123...abc eth"
        );
      }

      const walletAddress = params[0];
      const chainId = params[1].toLowerCase();

      // Create cache key
      const cacheKey = `tx_${walletAddress}_${chainId}`;
      
      // Check cache first for ultra-fast response
      if (cache.has(cacheKey)) {
        const cachedMessage = cache.get(cacheKey);
        return bot.sendMessage(chatId, cachedMessage, { 
          parse_mode: "Markdown",
          disable_web_page_preview: true 
        });
      }

      // Validate chain (cache chains too)
      const chainCacheKey = `chain_${chainId}`;
      let chain;
      
      if (cache.has(chainCacheKey)) {
        chain = cache.get(chainCacheKey);
      } else {
        chain = await Chain.findOne({ chainId });
        if (chain) {
          cache.set(chainCacheKey, chain, 300000); // Cache chains for 5 minutes
        }
      }
      
      if (!chain) {
        return bot.sendMessage(
          chatId,
          `⚠️ Chain '${chainId}' not supported. Supported chains: eth, base, polygon, solana`
        );
      }

      // Send immediate response
      bot.sendMessage(chatId, `⚡ Fetching recent transactions for ${walletAddress} on ${chainId}...`);

      let transactions = [];
      
      if (chain.type === "evm") {
        transactions = await getEvmTransactions(walletAddress, chain, 10);
      } else if (chain.type === "solana") {
        transactions = await getSolanaTransactions(walletAddress, 10);
      } else {
        return bot.sendMessage(
          chatId,
          `⚠️ Unsupported chain type: ${chain.type}`
        );
      }

      const message = formatTransactionList(transactions, walletAddress);
      
      // Cache the result for 60 seconds for ultra-fast subsequent requests
      cache.set(cacheKey, message, 60000);
      
      bot.sendMessage(chatId, message, { 
        parse_mode: "Markdown",
        disable_web_page_preview: true 
      });

    } catch (error) {
      console.error("Error fetching transactions:", error);
      bot.sendMessage(chatId, `❌ Error fetching transactions: ${error.message}`);
    }
  },

  // Show transactions menu with tracked wallets
  showTransactionsMenu: async (bot, msg) => {
    const chatId = msg.chat.id;

    try {
      // Get all active tracked wallets
      const trackedWallets = await TrackedWallet.find({ isActive: true }).sort({ chain: 1, address: 1 });

      if (trackedWallets.length === 0) {
        return bot.sendMessage(chatId, `
🔍 *Check Recent Transactions*

❌ No tracked wallets found. Add wallets first using /add command.

*Manual usage:*
\`/transactions <wallet_address> <chain>\`

*Supported chains:*
• \`eth\` - Ethereum • \`base\` - Base • \`polygon\` - Polygon • \`solana\` - Solana

*Example:* \`/transactions 0x123...abc eth\`
        `, { 
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[
              { text: "🔄 Back to Main Menu", callback_data: "menu_main" }
            ]]
          }
        });
      }

      // Group wallets by chain for better organization
      const walletsByChain = {};
      trackedWallets.forEach(wallet => {
        if (!walletsByChain[wallet.chain]) {
          walletsByChain[wallet.chain] = [];
        }
        walletsByChain[wallet.chain].push(wallet);
      });

      // Create inline keyboard with wallet buttons
      const keyboard = [];
      
      // Add wallet buttons grouped by chain
      Object.keys(walletsByChain).forEach(chain => {
        // Add chain header
        keyboard.push([{ 
          text: `📊 ${chain.toUpperCase()} Wallets`, 
          callback_data: `chain_header_${chain}` 
        }]);
        
        // Add wallet buttons for this chain
        walletsByChain[chain].forEach(wallet => {
          const shortAddress = `${wallet.address.substring(0, 6)}...${wallet.address.substring(wallet.address.length - 4)}`;
          const label = wallet.label ? ` (${wallet.label})` : '';
          
          keyboard.push([{
            text: `🔍 ${shortAddress}${label}`,
            callback_data: `tx_${wallet.address}_${wallet.chain}`
          }]);
        });
      });

      // Add manual input option and back button
      keyboard.push(
        [{ text: "✏️ Manual Input", callback_data: "tx_manual" }],
        [{ text: "🔄 Back to Main Menu", callback_data: "menu_main" }]
      );

      const message = `
🔍 *Check Recent Transactions*

Select a tracked wallet to view its recent transactions:

📊 *${trackedWallets.length} tracked wallet${trackedWallets.length !== 1 ? 's' : ''} available*

You can also use manual input for any wallet address.
      `;

      await bot.sendMessage(chatId, message, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: keyboard }
      });

    } catch (error) {
      console.error("Error showing transactions menu:", error);
      bot.sendMessage(chatId, `❌ Error loading wallets: ${error.message}`);
    }
  },

  // Menu callback handler
  handleMenuCallback: async (bot, callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;

    console.log(`Handling callback query: ${data} from chat ${chatId}`);

    // Answer the callback query to remove loading state
    await bot.answerCallbackQuery(callbackQuery.id);

    switch (data) {
      case 'menu_main':
        // Show main menu
        await module.exports.start(bot, { chat: { id: chatId } });
        break;
        
      case 'menu_add':
        await bot.sendMessage(chatId, `
📝 *Add Wallet to Track*

To add a wallet, use the command:
\`/add <wallet_address> <chain>\`

*Supported chains:*
• \`eth\` - Ethereum
• \`base\` - Base
• \`polygon\` - Polygon  
• \`solana\` - Solana

*Example:*
\`/add 0x123...abc eth\`
        `, { parse_mode: "Markdown" });
        break;
        
      case 'menu_remove':
        await bot.sendMessage(chatId, `
🗑️ *Remove Wallet from Tracking*

To remove a wallet, use the command:
\`/remove <wallet_address> <chain>\`

*Example:*
\`/remove 0x123...abc eth\`
        `, { parse_mode: "Markdown" });
        break;
        
      case 'menu_list':
        await module.exports.listWallets(bot, { chat: { id: chatId } });
        break;
        
      case 'menu_status':
        await module.exports.status(bot, { chat: { id: chatId } });
        break;
        
      case 'menu_balance':
        await bot.sendMessage(chatId, `
💰 *Check Wallet Balance*

To check your wallet balance on a specific chain:
\`/balance <chain>\`

*Supported chains:*
• \`eth\` - Ethereum
• \`base\` - Base  
• \`polygon\` - Polygon
• \`solana\` - Solana

*Example:*
\`/balance eth\`
        `, { parse_mode: "Markdown" });
        break;
        
      case 'menu_transactions':
        await module.exports.showTransactionsMenu(bot, { chat: { id: chatId } });
        break;

      case 'menu_help':
        await module.exports.help(bot, { chat: { id: chatId } });
        break;

      case 'tx_manual':
        await bot.sendMessage(chatId, `
✏️ *Manual Transaction Lookup*

To check recent transactions for any wallet:
\`/transactions <wallet_address> <chain>\`

*Supported chains:*
• \`eth\` - Ethereum
• \`base\` - Base  
• \`polygon\` - Polygon
• \`solana\` - Solana

*Example:*
\`/transactions 0x123...abc eth\`

This will show the 10 most recent transactions with timestamps, values, and explorer links.
        `, { 
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[
              { text: "🔄 Back to Transactions Menu", callback_data: "menu_transactions" },
              { text: "🏠 Main Menu", callback_data: "menu_main" }
            ]]
          }
        });
        break;
        
      default:
        // Handle wallet transaction requests (tx_address_chain format)
        if (data.startsWith('tx_') && !data.includes('manual') && !data.includes('chain_header')) {
          const parts = data.split('_');
          if (parts.length >= 3) {
            const address = parts.slice(1, -1).join('_'); // Handle addresses with underscores
            const chain = parts[parts.length - 1];
            
            console.log(`Fetching transactions for ${address} on ${chain}`);
            
            // Create a mock match object for the transactions function
            const mockMatch = [`/transactions ${address} ${chain}`, `${address} ${chain}`];
            await module.exports.transactions(bot, { chat: { id: chatId } }, mockMatch);
          }
        } else if (data.startsWith('chain_header_')) {
          // Just answer the callback for chain headers (they're not clickable actions)
          // No additional action needed
        } else {
          await bot.sendMessage(chatId, "Unknown menu option. Please try again.");
        }
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
