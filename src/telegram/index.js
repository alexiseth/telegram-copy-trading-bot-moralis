// src/telegram/index.js
const TelegramBot = require("node-telegram-bot-api");
const BotConfig = require("../db/models/botConfig");
require("dotenv").config();
const commandHandlers = require("./commands");

// Create a bot instance
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Initialize the bot
const initBot = async () => {
  console.log("Initializing Telegram bot...");

  // Register command handlers
  bot.onText(/\/start/, (msg) => {
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

  bot.onText(/\/help/, (msg) => {
    commandHandlers.help(bot, msg);
  });

  // Add specific command to set chat ID
  bot.onText(/\/setchatid/, (msg) => {
    commandHandlers.setChatId(bot, msg);
  });

  // Handle incoming messages
  bot.on("message", (msg) => {
    // Only respond to messages that start with a slash (commands)
    if (msg.text && msg.text.startsWith("/")) {
      const command = msg.text.split(" ")[0];

      // Check if the command is already handled
      const knownCommands = [
        "/start",
        "/add",
        "/remove",
        "/list",
        "/status",
        "/balance",
        "/help",
        "/setchatid",
      ];

      const isKnownCommand = knownCommands.some((cmd) =>
        command.startsWith(cmd)
      );

      if (!isKnownCommand) {
        const chatId = msg.chat.id;
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
