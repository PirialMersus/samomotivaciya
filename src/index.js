require('dotenv').config();
const { Bot, GrammyError, HttpError } = require('grammy');
const connectDB = require('./config/db');
const botControllers = require('./controllers/bot.controller');
const setupCronJobs = require('./services/cron');

const startApplication = async () => {
    // 1. Database Connection
    await connectDB();

    // 2. Initialize Telegram Bot
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
        console.error("FATAL ERROR: TELEGRAM_BOT_TOKEN is missing in .env");
        process.exit(1);
    }

    if (!process.env.GEMINI_API_KEY) {
        console.error("FATAL ERROR: GEMINI_API_KEY is missing in .env");
        process.exit(1);
    }

    if (!process.env.MONGODB_URI) {
        console.error("FATAL ERROR: MONGODB_URI is missing in .env");
        process.exit(1);
    }

    const bot = new Bot(botToken);

    // 3. Register Handlers
    bot.command('start', botControllers.handleStart);
    // Оставлена только базовая команда /start
    // Остальные перенесены в Reply-меню

    bot.on('my_chat_member', botControllers.handleMyChatMember);

    // Callbacks for Settings and Timezones
    bot.callbackQuery(/settings:(.+)/, botControllers.handleSettingsCallback);
    bot.callbackQuery(/timezone:(.+)/, botControllers.handleTimezoneCallback);
    bot.callbackQuery(/done:(.+)/, botControllers.handleTaskDoneCallback);
    bot.callbackQuery('remind_later', botControllers.handleRemindLaterCallback);

    // Fallback for document/photo/text (currently just processing text for simplicity of the prototype)
    bot.on('message:photo', botControllers.handlePhoto);
    bot.on('message:text', botControllers.handleText);

    bot.catch((err) => {
        const ctx = err.ctx;
        console.error(`Error while handling update ${ctx?.update?.update_id}:`);
        const e = err.error;
        if (e instanceof GrammyError) {
            console.error("Error in request:", e.description);
        } else if (e instanceof HttpError) {
            console.error("Could not contact Telegram:", e);
        } else {
            console.error("Unknown error:", e);
        }
    });

    // Global Error Handlers
    process.on('uncaughtException', (error) => {
        console.error('UNCAUGHT EXCEPTION 🔥:', error);
    });

    process.on('unhandledRejection', (reason, promise) => {
        console.error('UNHANDLED REJECTION 💥:', reason);
    });

    // 4. Setup Cron Jobs
    setupCronJobs(bot);

    // 5. Start Polling
    console.log("Bot mentor is starting polling...");
    bot.start();
};

startApplication();
