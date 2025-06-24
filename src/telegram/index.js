// src/telegram/index.js
const TelegramBot = require("node-telegram-bot-api");
const BotConfig = require("../db/models/botConfig");
require("dotenv").config();
const commandHandlers = require("./commands");

// Create a bot instance
let bot;

// Initialize the bot
const initBot = async () => {
  console.log("Initializing Telegram bot...");

  // Create bot instance with balanced polling
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { 
    polling: {
      interval: 1000,       // Poll every 1 second - fast but stable
      autoStart: true,
      params: {
        timeout: 10,        // Polling timeout
        limit: 50           // Process up to 50 updates at once
      }
    }
  });

  // Register command handlers
  bot.onText(/\/start/, (msg) => {
    console.log('Handling /start command');
    commandHandlers.start(bot, msg);
  });

  bot.onText(/\/add (.+)/, (msg, match) => {
    commandHandlers.addWallet(bot, msg, match);
  });

  bot.onText(/\/remove (.+)/, (msg, match) => {
    commandHandlers.removeWallet(bot, msg, match);
  });

  bot.onText(/\/list/, (msg) => {
    commandHandlers.listWallets(bot, msg);
  });

  bot.onText(/\/status/, (msg) => {
    commandHandlers.status(bot, msg);
  });

  bot.onText(/\/balance (.+)/, (msg, match) => {
    commandHandlers.balance(bot, msg, match);
  });

  bot.onText(/\/transactions (.+)/, (msg, match) => {
    commandHandlers.transactions(bot, msg, match);
  });

  bot.onText(/\/help/, (msg) => {
    commandHandlers.help(bot, msg);
  });

  // Add specific command to set chat ID
  bot.onText(/\/setchatid/, (msg) => {
    commandHandlers.setChatId(bot, msg);
  });

  // Handle callback queries (button presses)
  bot.on('callback_query', async (callbackQuery) => {
    try {
      await commandHandlers.handleMenuCallback(bot, callbackQuery);
    } catch (error) {
      console.error('Error handling callback query:', error.message);
      // Try to answer the callback query to prevent timeout
      try {
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Error processing request' });
      } catch (answerError) {
        console.error('Failed to answer callback query:', answerError.message);
      }
    }
  });

  // Handle incoming messages
  bot.on("message", (msg) => {
    console.log(`Received message: ${JSON.stringify(msg)}`);
    
    // Only respond to messages that start with a slash (commands)
    if (msg.text && msg.text.startsWith("/")) {
      const command = msg.text.split(" ")[0];
      console.log(`Processing command: ${command}`);

      // Check if the command is already handled
      const knownCommands = [
        "/start",
        "/add",
        "/remove",
        "/list",
        "/status",
        "/balance",
        "/transactions",
        "/help",
        "/setchatid",
      ];

      const isKnownCommand = knownCommands.some((cmd) =>
        command.startsWith(cmd)
      );

      if (!isKnownCommand) {
        const chatId = msg.chat.id;
        console.log(`Unknown command: ${command}`);
        bot.sendMessage(
          chatId,
          `Unknown command: ${command}\nUse /help to see available commands.`
        );
      }
    }
  });

  // Check if we have a stored chat ID
  try {
    const chatIdConfig = await BotConfig.findOne({ setting: "chatId" });
    if (chatIdConfig && chatIdConfig.value) {
      console.log(`Found stored chat ID: ${chatIdConfig.value}`);

      // Send a startup message if you want
      // await bot.sendMessage(chatIdConfig.value, '🤖 Bot has been restarted and is now online!');
    } else {
      console.log(
        "No chat ID found in database. Please run /start or /setchatid to set one."
      );
    }
  } catch (error) {
    console.error("Error checking for stored chat ID:", error);
  }

  // Add error handling for the bot
  bot.on('polling_error', (error) => {
    console.error('Polling error:', error.message);
  });

  bot.on('error', (error) => {
    console.error('Bot error:', error.message);
  });

  console.log("Telegram bot initialized and listening...");
  return bot;
};

// Get active chat ID from database
const getActiveChatId = async () => {
  try {
    const chatIdConfig = await BotConfig.findOne({ setting: "chatId" });
    if (chatIdConfig && chatIdConfig.value) {
      return chatIdConfig.value;
    }

    // Fallback to env variable
    if (process.env.ADMIN_CHAT_ID) {
      return process.env.ADMIN_CHAT_ID;
    }

    return null;
  } catch (error) {
    console.error("Error getting active chat ID:", error);
    return process.env.ADMIN_CHAT_ID || null;
  }
};

module.exports = {
  initBot,
  getBot: () => bot,
  getActiveChatId,
};
