import User from '../models/User.js';
import Report from '../models/Report.js';
import CustomTask from '../models/CustomTask.js';
import methodology from '../data/methodology.js';
import { InlineKeyboard } from 'grammy';
import { DateTime } from 'luxon';
import * as geminiService from '../services/gemini.js';
import { createSettingsKeyboard, createTimezoneRegionsKeyboard, createTimezoneCitiesKeyboard } from '../keyboards/settings.js';
import { createMainMenuKeyboard, createHelpMenuKeyboard } from '../keyboards/menus.js';
import https from 'https';
import http from 'http';

const downloadFileAsBase64 = (fileUrl) => {
    return new Promise((resolve, reject) => {
        const protocol = fileUrl.startsWith('https') ? https : http;
        protocol.get(fileUrl, (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
            response.on('error', reject);
        }).on('error', reject);
    });
};

const buildRoutineStatusText = (user, weekData, todayStr) => {
    if (!weekData || !weekData.daily_routine) return "Рутина не определена для этой недели.";

    const undoneTasks = [];
    const doneTasks = [];
    weekData.daily_routine.forEach(t => {
        const isDone = user.progress?.get(`${t.id}_${todayStr}`);
        if (isDone) {
            doneTasks.push(t.title);
        } else {
            undoneTasks.push(t.title);
        }
    });

    let statusText = `Выполнено: ${doneTasks.length}/${doneTasks.length + undoneTasks.length}.\n`;
    if (doneTasks.length > 0) statusText += `Сделано: ${doneTasks.join(', ')}.\n`;
    if (undoneTasks.length > 0) statusText += `НЕ ВЫПОЛНЕНО: ${undoneTasks.join(', ')}.`;
    else statusText += "Вся рутина выполнена.";

    return statusText;
};

const createCalendarKeyboard = (year, month) => {
    const keyboard = new InlineKeyboard();
    const dt = DateTime.local(year, month, 1);
    const monthName = dt.monthLong;

    keyboard.text(`<< ${monthName} ${year} >>`, "ignore").row();

    const days = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
    days.forEach(d => keyboard.text(d, "ignore"));
    keyboard.row();

    let firstDayOfWeek = dt.weekday; // 1-7
    for (let i = 1; i < firstDayOfWeek; i++) {
        keyboard.text(" ", "ignore");
    }

    const daysInMonth = dt.daysInMonth;
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = dt.set({ day }).toFormat('yyyy-MM-dd');
        keyboard.text(day.toString(), `set_date:${dateStr}`);
        if ((day + firstDayOfWeek - 1) % 7 === 0) keyboard.row();
    }

    keyboard.row().text("🔙 Назад", "add_task_date_back");
    return keyboard;
};

const processGeminiResult = async (ctx, user, geminiResult, originalText) => {
    const weekData = methodology.weeks[user.currentWeek];
    const dt = DateTime.now().setZone(user.timezone || 'Europe/Kyiv');
    const todayStr = dt.toFormat('yyyy-MM-dd');

    if ((geminiResult.isReport && geminiResult.verdict === "ПРИНЯТО") || geminiResult.isTaskSubmission) {
        const reportStatus = geminiResult.verdict === "ПРИНЯТО" ? 'approved' : 'task_only';
        const newReport = new Report({
            userId: user._id,
            week: user.currentWeek,
            day: user.currentDay,
            text: originalText,
            geminiFeedback: geminiResult.responseText,
            status: reportStatus
        });
        await newReport.save();

        if (geminiResult.completedTasks.length > 0) {
            geminiResult.completedTasks.forEach(taskId => {
                if (!user.completedGlobalTasks.includes(taskId)) {
                    user.completedGlobalTasks.push(taskId);
                }
            });
        }

        if (geminiResult.isReport && geminiResult.verdict === "ПРИНЯТО") {
            let dailyTotal = 0;
            let dailyDone = 0;
        if (weekData && weekData.daily_routine) {
            weekData.daily_routine.forEach(t => {
                dailyTotal++;
                if (user.progress?.get(`${t.id}_${todayStr}`)) dailyDone++;
            });
        }
            if (dailyTotal > 0 && dailyDone === dailyTotal) {
                user.totalRoutineDays += 1;
            }

            user.lastReportDate = todayStr;
        }

        const allGlobalTaskIds = weekData?.global_tasks
            ?.filter(t => !t.isPersistent)
            .map(t => t.id) || [];
        const isAllGlobalDone = allGlobalTaskIds.every(id => user.completedGlobalTasks.includes(id));
        const isAnyRoutineDone = user.totalRoutineDays >= 1;

        if (isAllGlobalDone && isAnyRoutineDone) {
            user.currentWeek += 1;
            user.currentDay = 1;
            user.completedGlobalTasks = [];
            user.totalRoutineDays = 0;
            await user.save();
            await ctx.reply(`<b>ВНИМАНИЕ!</b> Ты закрыл все задачи. Неделя ${user.currentWeek} началась. Введи /tasks.`, { parse_mode: 'HTML' });
        } else {
            let statusMsg = "Засчитано. ";
            if (!isAllGlobalDone) {
                const remainingTasks = allGlobalTaskIds.filter(id => !user.completedGlobalTasks.includes(id));
                statusMsg += `Остались хвосты по глобал-задачам (${remainingTasks.length} шт). `;
            }
            if (!isAnyRoutineDone) statusMsg += `Нужен хотя бы один день 100% рутины. `;
            await user.save();
            await ctx.reply(`<b>Сэнсэй:</b> ${statusMsg}`, { parse_mode: 'HTML' });
        }
    } else if (geminiResult.isReport && geminiResult.verdict === "ОТКЛОНЕНО") {
        const newReport = new Report({
            userId: user._id,
            week: user.currentWeek,
            day: user.currentDay,
            text: originalText,
            geminiFeedback: geminiResult.responseText,
            status: 'rejected'
        });
        await newReport.save();
        await user.save();
    } else {
        await user.save();
    }

    if (geminiResult.hasWhiningPenalty) {
        user.strikes = (user.strikes || 0) + 1;
        if (user.strikes >= 3) {
            user.frozen = true;
            user.unfreezeDate = DateTime.now().plus({ days: 1 }).toJSDate();
            await user.save();
            await ctx.reply(`<b>ФИНИШ.</b> Ты заморожен на 24 часа за нытье.`, { parse_mode: 'HTML' });
        } else {
            await user.save();
            await ctx.reply(`<b>СТРАЙК ЗА НЫТЬЕ!</b> У тебя ${user.strikes}/3. Еще косяк — и в бан.`, { parse_mode: 'HTML' });
        }
    }
};

const handleStart = async (ctx) => {
    const telegramId = ctx.from.id;
    const username = ctx.from.username || '';
    const isCreator = telegramId.toString() === process.env.CREATOR_ID;

    const keyboard = createMainMenuKeyboard();

    let user = await User.findOne({ telegramId });

    if (user && user.frozen) {
        const now = DateTime.now().toJSDate();
        if (user.unfreezeDate && now >= user.unfreezeDate) {
            user.frozen = false;
            user.strikes = 0;
            user.unfreezeDate = null;
            await user.save();
            await ctx.reply("<b>Сэнсэй:</b> Твое наказание окончено. Я разморозил твой доступ. Не заставляй меня делать это снова. Соберись и работай.", { parse_mode: 'HTML', reply_markup: keyboard });
            return;
        }
    }

    if (!user) {
        user = new User({ telegramId, username, isRegistered: true });
        await user.save();

        const adminId = process.env.CREATOR_ID;
        if (adminId && telegramId.toString() !== adminId) {
            await ctx.api.sendMessage(adminId, `<b>[НОВЫЙ ПОДОПЕЧНЫЙ]</b>\n\nАккаунт: @${username || 'без username'}\nID: <code>${telegramId}</code>\n\n+1 человек в системе.`, { parse_mode: 'HTML' });
        }

        await ctx.reply(`Добро пожаловать в ад, ${username || 'салага'}. Я твой ментор на ближайшие 12 недель. Никаких поблажек. Никаких соплей. Выполняешь задания вовремя — двигаешься дальше. Первая неделя началась.`, { reply_markup: keyboard });
    } else if (user.frozen && !isCreator) {
        const unfreezeStr = user.unfreezeDate ? DateTime.fromJSDate(user.unfreezeDate).setZone(user.timezone || 'Europe/Kyiv').toFormat('HH:mm dd.MM') : "неизвестно";
        await ctx.reply(`Ты заморожен за невыполнение требований или нытье. Твой доступ будет восстановлен автоматически: <b>${unfreezeStr}</b>. До этого момента — молчи и думай.`, { parse_mode: 'HTML' });
    } else {
        await ctx.reply(`Чего прохлаждаешься? У тебя идет Неделя ${user.currentWeek}. Жми кнопки ниже.`, { reply_markup: keyboard });
    }
};

const handleProgress = async (ctx) => {
    const user = await User.findOne({ telegramId: ctx.from.id });
    if (!user) return ctx.reply("Сначала нажми /start.");

    const dt = DateTime.now().setZone(user.timezone || 'Europe/Kyiv');
    const todayStr = dt.toFormat('yyyy-MM-dd');

    const weekData = methodology.weeks[user.currentWeek];
    let totalTasks = 0;
    let doneTasks = 0;

    if (weekData && weekData.daily_routine) {
        weekData.daily_routine.forEach(t => {
            totalTasks++;
            const isDone = user.progress?.get(`${t.id}_${todayStr}`);
            if (isDone) doneTasks++;
        });
    }

    const strikes = user.strikes || 0;
    const hasReportToday = user.lastReportDate === todayStr;

    let text = `<b>📈 ПРОГРЕСС</b>\n\nНеделя: ${user.currentWeek} | День: ${user.currentDay}\n`;
    text += `Задач на сегодня выполнено: ${doneTasks} из ${totalTasks}\n`;
    text += `Отчёт за сегодня: ${hasReportToday ? '✅ Сдан' : '❌ Не сдан'}\n`;
    text += `Страйков за косяки и нытье: ${strikes}/3\n`;

    if (user.currentWeek === 8) {
        const staticDone = user.progress?.get(`static_willpower_${todayStr}`) ? "Выполнена ✅" : "Нет ❌";
        text += `\n<b>Неделя 8 (Статика и Капитал):</b>\nСобрано обещаний на сумму: <b>${user.socialCapitalEur || 0} евро</b>.\nСтатика: <b>${staticDone}</b>\n`;
    }

    if (user.currentWeek === 9) {
        text += `\n<b>Неделя 9 (Спираль Ценностей):</b>\nАудит ограничений: <b>записано ${user.auditBeliefsCount || 0} убеждений</b>.\n`;
    }

    if (user.currentWeek === 10) {
        text += `\n<b>Неделя 10 (Тюнинг и Наставничество):</b>\nНаставник: <b>${user.hasMentor ? "Найден ✅" : "Нет ❌"}</b>.\nУченики: <b>${user.followersCount || 0}/3</b>.\n`;
    }

    if (strikes >= 2) {
        text += `\n<i>⚠️ Ты на грани вылета. Соберись.</i>`;
    }

    await ctx.reply(text, { parse_mode: 'HTML' });
};

const handleTasks = async (ctx) => {
    const user = await User.findOne({ telegramId: ctx.from.id });
    if (!user) return ctx.reply("Сначала нажми /start.");
    const isCreator = user.telegramId.toString() === process.env.CREATOR_ID;
    if (user.frozen && !isCreator) return ctx.reply("Замороженные не получают задач.");

    const weekData = methodology.weeks[user.currentWeek];
    if (!weekData) return ctx.reply("Задания для этой недели пока не готовы. Свободен.");

    const dt = DateTime.now().setZone(user.timezone || 'Europe/Kyiv');
    const todayStr = dt.toFormat('yyyy-MM-dd');

    const customTasks = await CustomTask.find({ telegramId: user.telegramId, date: todayStr });

    let message = `<b>${weekData.title}</b>\n\n`;
    message += `<b>Ежедневная рутина:</b>\n`;
    weekData.daily_routine.forEach(t => {
        const isDone = user.progress?.get(`${t.id}_${todayStr}`);
        message += `${isDone ? '✅' : '❌'} ${t.title}\n`;
    });

    if (customTasks.length > 0) {
        message += `\n<b>Твои личные задачи:</b>\n`;
        customTasks.forEach(t => {
            message += `${t.isDone ? '✅' : '❌'} ${t.title}\n`;
        });
    }

    message += `\n<b>Глобальные задачи недели:</b>\n`;
    weekData.global_tasks?.forEach(t => {
        const isDone = user.completedGlobalTasks?.includes(t.id);
        const icon = t.isPersistent ? '🔄' : (isDone ? '✅' : '❌');
        message += `🔥 ${t.title} ${icon}\n`;
    });

    if (user.currentWeek === 5) {
        message += `\n⚠️ <b>БОЛЬШАЯ ЧИСТКА:</b>\nЗавершение ВСЕХ хвостов за недели 1-4.\n`;
    }

    if (weekData.taboo && weekData.taboo.length > 0) {
        message += `\n<b>Табу:</b>\n${weekData.taboo.join(', ')}`;
    }

    const taskKeyboard = new InlineKeyboard();
    let hasTaskButtons = false;

    weekData.daily_routine.forEach(t => {
        const isDone = user.progress?.get(`${t.id}_${todayStr}`);
        if (!isDone) {
            taskKeyboard.text(`Сделал ✅: ${t.title}`, `done:${t.id}`).row();
            hasTaskButtons = true;
        }
    });

    customTasks.forEach(t => {
        if (!t.isDone) {
            taskKeyboard.text(`Сделал ✅: ${t.title}`, `custom_done:${t._id}`).row();
            hasTaskButtons = true;
        }
        taskKeyboard.text(`🗑 Удалить: ${t.title}`, `custom_del:${t._id}`).row();
        hasTaskButtons = true;
    });

    taskKeyboard.text("➕ Добавить свою задачу", "add_task_step_title").row();
    hasTaskButtons = true;

    if (ctx.callbackQuery) {
        await ctx.editMessageText(message, {
            parse_mode: 'HTML',
            reply_markup: hasTaskButtons ? taskKeyboard : undefined
        });
    } else {
        await ctx.reply(message, {
            parse_mode: 'HTML',
            reply_markup: hasTaskButtons ? taskKeyboard : undefined
        });
    }
};

const handleTaskDoneCallback = async (ctx) => {
    const taskId = ctx.match[1];
    const user = await User.findOne({ telegramId: ctx.from.id });
    if (!user) return;

    const dt = DateTime.now().setZone(user.timezone || 'Europe/Kyiv');
    const todayStr = dt.toFormat('yyyy-MM-dd');

    if (!user.progress) user.progress = new Map();

    const progressKey = `${taskId}_${todayStr}`;
    if (user.progress.get(progressKey)) {
        await ctx.answerCallbackQuery({ text: "Уже отмечено!" });
        return;
    }

    user.progress.set(progressKey, true);
    await user.save();

    await ctx.answerCallbackQuery({ text: "Принято!" });
    await ctx.reply(`<b>Сэнсэй:</b> Хвалю за дисциплину! Продолжай.`, { parse_mode: 'HTML' });

    try {
        await handleTasks(ctx);
    } catch (e) {
        if (e.description?.includes("message is not modified")) return;
        console.error(e);
    }
};

const handleCustomTaskCallback = async (ctx) => {
    const [action, taskId] = ctx.match[0].split(':');
    const user = await User.findOne({ telegramId: ctx.from.id });
    if (!user) return;

    if (action === 'custom_done') {
        const task = await CustomTask.findById(taskId);
        if (task && !task.isDone) {
            task.isDone = true;
            await task.save();
            await ctx.answerCallbackQuery({ text: "Задача выполнена!" });
            await ctx.reply(`<b>Сэнсэй:</b> Личная дисциплина — основа стержня. Красава.`, { parse_mode: 'HTML' });
        }
    } else if (action === 'custom_del') {
        await CustomTask.findByIdAndDelete(taskId);
        await ctx.answerCallbackQuery({ text: "Задача удалена." });
    }

    try {
        await handleTasks(ctx);
    } catch (e) {
        if (!e.description?.includes("message is not modified")) console.error(e);
    }
};

const handleAddTaskCallback = async (ctx) => {
    const action = ctx.match[0];
    const user = await User.findOne({ telegramId: ctx.from.id });
    if (!user) return;

    if (action === "add_task_step_title") {
        user.addingTaskStep = 'title';
        await user.save();
        await ctx.reply("Введи название своей задачи (например: Купить хлеб):");
    } else if (action === "add_task_date_back") {
        user.addingTaskStep = 'title';
        await user.save();
        await ctx.editMessageText("Введи название своей задачи:");
    } else if (action === "show_calendar") {
        const now = DateTime.now().setZone(user.timezone || 'Europe/Kyiv');
        await ctx.editMessageText("Выбери дату на календаре:", {
            reply_markup: createCalendarKeyboard(now.year, now.month)
        });
    }

    await ctx.answerCallbackQuery();
};

const handleSetDateCallback = async (ctx) => {
    const dateStr = ctx.match[1];
    const user = await User.findOne({ telegramId: ctx.from.id });
    if (!user || user.addingTaskStep !== 'date') return;

    const newTask = new CustomTask({
        userId: user._id,
        telegramId: user.telegramId,
        title: user.tempTaskTitle,
        date: dateStr
    });
    await newTask.save();

    user.addingTaskStep = null;
    user.tempTaskTitle = '';
    await user.save();

    await ctx.answerCallbackQuery({ text: "Задача добавлена!" });
    await ctx.editMessageText(`Задача «<b>${newTask.title}</b>» добавлена на <b>${dateStr}</b>.`, { parse_mode: 'HTML' });

    // Показываем обновленный список если дата совпадает с сегодня
    const dt = DateTime.now().setZone(user.timezone || 'Europe/Kyiv');
    if (dateStr === dt.toFormat('yyyy-MM-dd')) {
        await handleTasks(ctx);
    }
};

const handleShowLectureCallback = async (ctx) => {
    const user = await User.findOne({ telegramId: ctx.from.id });
    if (!user) return;

    const weekData = methodology.weeks[user.currentWeek];
    if (!weekData || !weekData.lecture_notes) {
        if (ctx.callbackQuery) {
            return ctx.answerCallbackQuery({ text: "Конспект пока не готов." });
        } else {
            return ctx.reply("Конспект пока не готов.");
        }
    }

    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    await ctx.reply(`<b>📚 КОНСПЕКТ НЕДЕЛИ ${user.currentWeek}</b>\n\n${weekData.lecture_notes}`, { parse_mode: 'HTML' });
};

const handleSettings = async (ctx) => {
    const user = await User.findOne({ telegramId: ctx.from.id });
    if (!user) return ctx.reply("Сначала нажми /start.");

    await ctx.reply(`Текущий часовой пояс: <b>${user.timezone}</b>\n\nВыбери изменение:`, {
        parse_mode: 'HTML',
        reply_markup: createSettingsKeyboard()
    });
};

const handleSettingsCallback = async (ctx) => {
    const action = ctx.match[1];
    if (action === 'timezone') {
        await ctx.editMessageText("Выбери свой регион:", {
            reply_markup: createTimezoneRegionsKeyboard()
        });
    } else if (action === 'back') {
        const user = await User.findOne({ telegramId: ctx.from.id });
        await ctx.editMessageText(`Текущий часовой пояс: <b>${user.timezone}</b>\n\nВыбери изменение:`, {
            parse_mode: 'HTML',
            reply_markup: createSettingsKeyboard()
        });
    } else if (action === 'close') {
        await ctx.deleteMessage();
    }
    await ctx.answerCallbackQuery();
};

const handleTimezoneCallback = async (ctx) => {
    const data = ctx.match[1];
    if (data.startsWith('region:')) {
        const region = data.split(':')[1];
        await ctx.editMessageText("Выбери свой город:", {
            reply_markup: createTimezoneCitiesKeyboard(region)
        });
    } else if (data.startsWith('set:')) {
        const timezone = data.split(':')[1];
        await User.findOneAndUpdate({ telegramId: ctx.from.id }, { timezone });
        await ctx.editMessageText(`Часовой пояс успешно изменен на: <b>${timezone}</b>`, {
            parse_mode: 'HTML',
            reply_markup: createSettingsKeyboard()
        });
    }
    await ctx.answerCallbackQuery();
};

const handleRemindLaterCallback = async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Напомню позже!" });
};

const sendToGeminiAndRespond = async (ctx, user, contentParts, originalText) => {
    const now = new Date();
    if (user.lastGeminiCall) {
        const diffMs = now - user.lastGeminiCall;
        if (diffMs < 60000) { // 1 минута
            const waitSec = Math.ceil((60000 - diffMs) / 1000);
            return ctx.reply(`⚠️ <b>Сэнсэй занят.</b> Подожди ${waitSec} сек. Не части, я не справочное бюро.`, { parse_mode: 'HTML' });
        }
    }
    user.lastGeminiCall = now;
    await user.save();

    const weekData = methodology.weeks[user.currentWeek];
    const dt = DateTime.now().setZone(user.timezone || 'Europe/Kyiv');
    const todayStr = dt.toFormat('yyyy-MM-dd');

    const routineStatusText = buildRoutineStatusText(user, weekData, todayStr);

    const loadingMsg = await ctx.reply("⏳ <b>Сэнсэй анализирует...</b>", { parse_mode: 'HTML' });

    const geminiResult = await geminiService.processUserMessage(contentParts, user.currentWeek, routineStatusText);

    try {
        await ctx.api.editMessageText(ctx.chat.id, loadingMsg.message_id, geminiResult.responseText, { parse_mode: 'HTML' });
    } catch (e) {
        try {
            await ctx.api.editMessageText(ctx.chat.id, loadingMsg.message_id, geminiResult.responseText);
        } catch (e2) {
            console.error("Failed to edit loading message:", e2.message);
        }
    }

    await processGeminiResult(ctx, user, geminiResult, originalText);
};

const handleText = async (ctx) => {
    const user = await User.findOne({ telegramId: ctx.from.id });
    if (!user) return ctx.reply("Жми /start.");

    user.lastActivityAt = new Date();
    await user.save();

    const isCreator = user.telegramId.toString() === process.env.CREATOR_ID;
    if (user.frozen && !isCreator) {
        const now = DateTime.now().toJSDate();
        if (user.unfreezeDate && now >= user.unfreezeDate) {
            user.frozen = false;
            user.strikes = 0;
            user.unfreezeDate = null;
            await user.save();
        } else {
            return ctx.reply("Замороженные права голоса не имеют.");
        }
    }

    const text = ctx.message.text;

    if (text === "⚙️ Настройки") return handleSettings(ctx);
    if (text === "📚 Задания") return handleTasks(ctx);
    if (text === "📈 Прогресс") return handleProgress(ctx);
    if (text === "🧘 Сэнсэй, помоги!") {
        return ctx.reply("Это раздел помощи. Здесь ты можешь изучить теорию текущей недели или задать вопрос Сэнсэю напрямую.", {
            reply_markup: createHelpMenuKeyboard()
        });
    }

    if (user.addingTaskStep === 'title') {
        user.tempTaskTitle = text;
        user.addingTaskStep = 'date';
        await user.save();

        const dt = DateTime.now().setZone(user.timezone || 'Europe/Kyiv');
        const today = dt.toFormat('yyyy-MM-dd');
        const tomorrow = dt.plus({ days: 1 }).toFormat('yyyy-MM-dd');

        const keyboard = new InlineKeyboard()
            .text("Сегодня", `set_date:${today}`)
            .text("Завтра", `set_date:${tomorrow}`)
            .row()
            .text("📅 Выбрать дату", "show_calendar").row()
            .text("🔙 Назад", "add_task_step_title");

        return ctx.reply(`Задача: <b>${text}</b>\nНа какое число ставим?`, {
            parse_mode: 'HTML',
            reply_markup: keyboard
        });
    }

    if (text === "📚 Конспект лекции") return handleShowLectureCallback(ctx);

    if (text === "❓ Задать вопрос") {
        user.isAskingHelp = true;
        await user.save();
        return ctx.reply("Излагай. Только помни: нытье = 50 отжиманий.");
    }

    if (text === "✍️ Написать админу") {
        user.isMessagingAdmin = true;
        await user.save();
        return ctx.reply("Пиши свое сообщение админу. Я перешлю как есть. Только не спамь.");
    }

    if (text === "🔙 Назад") {
        return ctx.reply("Возвращаю в главное меню. Не расслабляйся.", {
            reply_markup: createMainMenuKeyboard()
        });
    }

    if (user.isMessagingAdmin) {
        user.isMessagingAdmin = false;
        await user.save();
        const adminId = process.env.CREATOR_ID;
        if (adminId) {
            await ctx.api.sendMessage(adminId, `<b>[СООБЩЕНИЕ АДМИНУ]</b> от @${user.username || user.telegramId}:\n\n${text}`, { parse_mode: 'HTML' });
            return ctx.reply("Отправлено. Админ ответит, как только вылезет из танка.");
        } else {
            return ctx.reply("Ошибка: ID админа не настроен.");
        }
    }

    if (user.isAskingHelp) {
        user.isAskingHelp = false;
        await user.save();
    }

    if (user.currentWeek === 8) {
        const eurMatch = text.match(/^\s*(\d+)\s*(евро|eur|€)?\s*$/i);
        if (eurMatch) {
            user.socialCapitalEur = parseInt(eurMatch[1], 10);
            await user.save();
            return ctx.reply(`<b>Цена твоего слова:</b> ${user.socialCapitalEur} евро зафиксирована.`, { parse_mode: 'HTML' });
        }
    }

    const contentParts = [text];
    await sendToGeminiAndRespond(ctx, user, contentParts, text);
};

const handleVoice = async (ctx) => {
    const user = await User.findOne({ telegramId: ctx.from.id });
    if (!user) return ctx.reply("Жми /start.");

    user.lastActivityAt = new Date();
    await user.save();

    const isCreator = user.telegramId.toString() === process.env.CREATOR_ID;
    if (user.frozen && !isCreator) {
        const now = DateTime.now().toJSDate();
        if (user.unfreezeDate && now >= user.unfreezeDate) {
            user.frozen = false;
            user.strikes = 0;
            user.unfreezeDate = null;
            await user.save();
        } else {
            return ctx.reply("Замороженные права голоса не имеют.");
        }
    }

    if (user.isMessagingAdmin) {
        user.isMessagingAdmin = false;
        await user.save();
        return ctx.reply("Голосовые для админа пока не поддерживаются. Напиши текстом.");
    }

    if (user.isAskingHelp) {
        user.isAskingHelp = false;
        await user.save();
    }

    try {
        const voiceFile = ctx.message.voice || ctx.message.audio;
        if (!voiceFile) return ctx.reply("Не удалось получить аудиофайл.");

        const file = await ctx.getFile();
        const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

        const audioBase64 = await downloadFileAsBase64(fileUrl);

        const mimeType = voiceFile.mime_type || 'audio/ogg';

        const contentParts = [
            {
                inlineData: {
                    mimeType: mimeType,
                    data: audioBase64
                }
            },
            "Выше прикреплено аудиосообщение от подопечного. Проанализируй его содержание."
        ];

        await sendToGeminiAndRespond(ctx, user, contentParts, "[Аудиосообщение]");
    } catch (error) {
        console.error("Voice processing error:", error);
        await ctx.reply("Ошибка при обработке голосового. Попробуй ещё раз или напиши текстом.");
    }
};

const handleMyChatMember = async (ctx) => {
    try {
        const newStatus = ctx.myChatMember.new_chat_member.status;
        if (newStatus === 'kicked') {
            const user = await User.findOne({ telegramId: ctx.from.id });
            if (user) {
                await Report.deleteMany({ userId: user._id });
                await CustomTask.deleteMany({ userId: user._id });
                await User.deleteOne({ telegramId: ctx.from.id });
            }
        }
    } catch (error) {
        console.error(error);
    }
};

export {
    handleStart, handleProgress, handleSettings, handleSettingsCallback,
    handleTimezoneCallback, handleTasks, handleTaskDoneCallback,
    handleShowLectureCallback, handleRemindLaterCallback,
    handleText, handleVoice, handleMyChatMember
};