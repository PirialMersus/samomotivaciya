import express from 'express';
import 'dotenv/config';
import { Bot, GrammyError, HttpError } from 'grammy';
import connectDB from './config/db.js';
import * as botControllers from './controllers/bot.controller.js';
import setupCronJobs from './services/cron.js';
import User from './models/User.js'; // Импорт для работы команды /setweek

const startApplication = async () => {
    // 1. Подключение к базе данных
    await connectDB();

    // 2. Инициализация Express (для health-checks на Render)
    const app = express();
    const PORT = process.env.PORT || 3000;

    app.get('/health', (req, res) => {
        res.status(200).send('Sensei is watching you...');
    });

    app.listen(PORT, () => {
        console.log(`Web server is running on port ${PORT}`);
    });

    // 3. Инициализация Telegram Bot
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
        console.error("FATAL ERROR: TELEGRAM_BOT_TOKEN is missing");
        process.exit(1);
    }

    const bot = new Bot(botToken);

    // --- СЕКРЕТНЫЕ КОМАНДЫ АДМИНА ---
    bot.command('setweek', async (ctx) => {
        // Используем переменную из .env для проверки прав
        const ADMIN_ID = Number(process.env.ADMIN_TELEGRAM_ID);

        if (ctx.from.id !== ADMIN_ID) return;

        const week = parseInt(ctx.message.text.split(' ')[1]);
        if (week >= 1 && week <= 12) {
            try {
                await User.findOneAndUpdate(
                    { chatId: ctx.from.id },
                    { currentWeek: week },
                    { upsert: true }
                );
                await ctx.reply(`📊 <b>Режим теста:</b> установлена неделя ${week}\n\nФилипп готов проверять отчеты по новым правилам.`, { parse_mode: 'HTML' });
            } catch (err) {
                console.error('Update week error:', err);
                await ctx.reply('Ошибка при обновлении недели в базе.');
            }
        } else {
            await ctx.reply('Укажи номер недели. Пример: /setweek 5');
        }
    });

    // --- РЕГИСТРАЦИЯ ОБРАБОТЧИКОВ ---
    bot.command('start', botControllers.handleStart);
    bot.on('my_chat_member', botControllers.handleMyChatMember);

    // Колбэк для закрытия настроек (вместо кнопки "Назад")
    bot.callbackQuery('close_settings', async (ctx) => {
        try {
            await ctx.deleteMessage();
        } catch (e) {
            // Игнорируем, если сообщение уже удалено
        }
    });

    // Обработка остальных колбэков
    bot.callbackQuery(/settings:(.+)/, botControllers.handleSettingsCallback);
    bot.callbackQuery(/timezone:(.+)/, botControllers.handleTimezoneCallback);
    bot.callbackQuery(/done:(.+)/, botControllers.handleTaskDoneCallback);
    bot.callbackQuery(/custom_(done|del):(.+)/, botControllers.handleCustomTaskCallback);
    bot.callbackQuery(/add_task_(.+)/, botControllers.handleAddTaskCallback);
    bot.callbackQuery("show_calendar", botControllers.handleAddTaskCallback);
    bot.callbackQuery(/set_date:(.+)/, botControllers.handleSetDateCallback);
    bot.callbackQuery('show_lecture', botControllers.handleShowLectureCallback);
    bot.callbackQuery('remind_later', botControllers.handleRemindLaterCallback);

    bot.on('message:voice', botControllers.handleVoice);
    bot.on('message:audio', botControllers.handleVoice);

    // Основной прием текстовых сообщений (отчеты и общение)
    bot.on('message:text', botControllers.handleText);

    // Глобальный обработчик ошибок
    bot.catch((err) => {
        const ctx = err.ctx;
        const e = err.error;

        // Подавляем ошибку "сообщение не изменено", чтобы не спамить в консоль
        if (e instanceof GrammyError && e.description.includes('message is not modified')) {
            return;
        }

        console.error(`Error while handling update ${ctx?.update?.update_id}:`);
        if (e instanceof GrammyError) {
            console.error("Error in request:", e.description);
        } else if (e instanceof HttpError) {
            console.error("Could not contact Telegram:", e);
        } else {
            console.error("Unknown error:", e);
        }
    });

    // Обработчики критических падений процесса
    process.on('uncaughtException', (error) => {
        console.error('UNCAUGHT EXCEPTION 🔥:', error);
    });

    process.on('unhandledRejection', (reason) => {
        console.error('UNHANDLED REJECTION 💥:', reason);
    });

    // 5. Запуск Cron-задач (напоминания и прочее)
    setupCronJobs(bot);

    // 6. Запуск бота
    console.log("Bot mentor is starting polling...");
    bot.start();
};

startApplication();