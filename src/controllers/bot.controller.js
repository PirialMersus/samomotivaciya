import User from '../models/User.js';
import Report from '../models/Report.js';
import CustomTask from '../models/CustomTask.js';
import methodology, { getFullDailyRoutine, getFullTaboo } from '../data/methodology.js';
import { InlineKeyboard } from 'grammy';
import { DateTime } from 'luxon';
import * as geminiService from '../services/gemini.js';
import { getTasksMessage } from '../services/task.service.js';
import { getTone } from '../utils/tone.js';
import { createSettingsKeyboard, createTimezoneRegionsKeyboard, createTimezoneCitiesKeyboard } from '../keyboards/settings.js';
import { createMainMenuKeyboard, createHelpMenuKeyboard } from '../keyboards/menus.js';
import { createCalendarKeyboard } from '../keyboards/calendar.js';
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

const buildRoutineStatusText = (user, weekData, todayStr, weekNumber) => {
    if (!weekData) return "Рутина не определена для этой недели.";

    const fullDailyRoutine = getFullDailyRoutine(weekNumber);
    const fullTaboo = getFullTaboo(weekNumber);
    const undoneTasks = [];
    const doneTasks = [];
    [...fullDailyRoutine, ...fullTaboo].forEach(t => {
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

const processGeminiResult = async (ctx, user, geminiResult, originalText) => {
    const weekData = methodology.weeks[user.currentWeek];
    const dt = DateTime.now().setZone(user.timezone || 'Europe/Kyiv');
    const todayStr = dt.toFormat('yyyy-MM-dd');

    let reportStatus = 'chat';
    if (geminiResult.isDailyReportAccepted) reportStatus = 'approved_daily';
    else if (geminiResult.completedTasks.length > 0) reportStatus = 'approved_task';

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
            if (taskId === 'time_tracking') {
                user.progress = user.progress || new Map();
                user.progress.set(`time_tracking_${todayStr}`, true);
            } else if (!user.completedGlobalTasks.includes(taskId)) {
                user.completedGlobalTasks.push(taskId);
            }
        });
    }

    if (geminiResult.isDailyReportAccepted) {
        let dailyTotal = 0;
        let dailyDone = 0;
        if (weekData) {
            const fullRoutineForDay = [...getFullDailyRoutine(user.currentWeek), ...getFullTaboo(user.currentWeek)];
            fullRoutineForDay.forEach(t => {
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
    
    // Переход произойдет только если есть хотя бы 1 глобальная задача и она(и) выполнена, + рутина. Либо если глобальных нет (что вряд ли), то `every` вернет true
    const isAllGlobalDone = allGlobalTaskIds.length > 0 ? allGlobalTaskIds.every(id => user.completedGlobalTasks.includes(id)) : true;

    if (isAllGlobalDone) {
        if (!user.isReadyForNextWeek) {
            user.isReadyForNextWeek = true;
            await user.save();
            const nextTone = getTone(user.currentWeek + 1);
            await ctx.reply(`<b>Сэнсэй:</b> Поздравляю! Все глобальные задачи этой недели приняты. Ты повышен в звании! Твой следующий статус: <b>${nextTone.label}</b>. 🏆\n\nНо не расслабляйся — добей всю рутину на сегодня. Технический переход на новую неделю будет ровно в полночь. 🦾`, { parse_mode: 'HTML' });
        } else {
            // Если флаг уже стоит, просто сохраняем прогресс по отчету
            await user.save();
        }
    } else {
        if (geminiResult.isDailyReportAccepted || geminiResult.completedTasks.length > 0) {
            let statusMsg = "засчитано.\n";
            const remainingTasks = weekData?.global_tasks
                ?.filter(t => !t.isPersistent && !user.completedGlobalTasks.includes(t.id))
                .map(t => t.title) || [];
            
            if (remainingTasks.length > 0) {
                statusMsg += `\nДля перехода на следующую неделю нужно выполнить:\n— ${remainingTasks.join('\n— ')}`;
            }
            await ctx.reply(`<b>Сэнсэй:</b> ${statusMsg}`, { parse_mode: 'HTML' });
        }
        await user.save();
    }

    if (geminiResult.hasWhiningPenalty) {
        user.strikes = (user.strikes || 0) + 1;
        if (user.strikes >= 5) {
            user.frozen = true;
            user.unfreezeDate = DateTime.now().setZone(user.timezone || 'Europe/Kyiv').plus({ days: 1 }).toJSDate();
            await user.save();
            await ctx.reply(`<b>ФИНИШ.</b> Ты заморожен на 24 часа за нытье.`, { parse_mode: 'HTML' });
            if (user.contractFileId) {
                await ctx.replyWithPhoto(user.contractFileId, { caption: "Вспомни, под чем ты подписывался.\nНеустойка уже ждет тебя." });
            }
        } else {
            const tone = getTone(user.currentWeek);
            await user.save();
            await ctx.reply(`<b>СТРАЙК ЗА НЫТЬЕ!</b> ${tone.strike} У тебя ${user.strikes}/5.`, { parse_mode: 'HTML' });
            if (user.contractFileId) {
                await ctx.replyWithPhoto(user.contractFileId, { caption: "Вспомни, под чем ты подписывался.\nНеустойка уже ждет тебя." });
            }
        }
    }
};

const handleStart = async (ctx) => {
    const telegramId = ctx.from.id;
    const username = ctx.from.username || '';
    const isCreator = telegramId.toString() === process.env.CREATOR_ID;
    const keyboard = createMainMenuKeyboard(isCreator);

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

        const tone = getTone(user.currentWeek);
        const adminId = process.env.CREATOR_ID;
        if (adminId && telegramId.toString() !== adminId) {
            await ctx.api.sendMessage(adminId, `<b>[НОВЫЙ ПОДОПЕЧНЫЙ]</b>\n\nАккаунт: @${username || 'без username'}\nID: <code>${telegramId}</code>\n\n+1 человек в системе.`, { parse_mode: 'HTML' });
        }

        await ctx.reply(`Привет! 👋 Это твой старт в «Тренировочный лагерь», ${tone.label}! 🚀\nЗа 12 недель мы создадим лучшую версию тебя! 💪✨\n\nЧто ты получишь на финише:\n🔥 <b>Тело мечты:</b> подтянутое, сильное и здоровое.\n⚡️ <b>Железная энергия:</b> забудь про усталость, живи на полную!\n🎯 <b>Ясность и фокус:</b> ты будешь точно знать, чего хочешь и как это взять.\n🌟 <b>Уверенность и статус:</b> новый уровень жизни, который заметят все!\n\nЭто будет твое самое крутое приключение. Готов(а) зажечь? Погнали! 🦾🔥\n\n❗️ <b>Обязательно прочитай «📜 Правила игры» в разделе «ℹ️ Помощь и Правила».</b>`, { reply_markup: keyboard, parse_mode: 'HTML' });
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

    if (weekData) {
        [...getFullDailyRoutine(user.currentWeek), ...getFullTaboo(user.currentWeek)].forEach(t => {
            totalTasks++;
            const isDone = user.progress?.get(`${t.id}_${todayStr}`);
            if (isDone) doneTasks++;
        });
    }

    const strikes = user.strikes || 0;
    const hasReportToday = user.lastReportDate === todayStr;

    const allGlobalTaskIds = weekData?.global_tasks
        ?.filter(t => !t.isPersistent)
        .map(t => t.id) || [];
    const doneGlobalTasks = allGlobalTaskIds.filter(id => user.completedGlobalTasks.includes(id)).length;
    const totalGlobalTasks = allGlobalTaskIds.length;

    let text = `<b>📈 ПРОГРЕСС</b>\n\nНеделя: ${user.currentWeek} | День: ${user.currentDay}\n`;
    text += `Задач на сегодня выполнено: ${doneTasks} из ${totalTasks}\n`;
    text += `Глобальных задач за неделю: ${doneGlobalTasks} из ${totalGlobalTasks}\n`;
    text += `Отчёт за сегодня: ${hasReportToday ? '✅ Сдан' : '❌ Не сдан'}\n`;
    text += `Страйков за косяки и нытье: ${strikes}/5\n`;

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

    const dt = DateTime.now().setZone(user.timezone || 'Europe/Kyiv');
    const todayStr = dt.toFormat('yyyy-MM-dd');

    const tasksData = await getTasksMessage(user, todayStr);
    if (!tasksData) return ctx.reply("Задания для этой недели пока не готовы. Свободен.");

    const { text: message, reply_markup: taskKeyboard } = tasksData;

    if (ctx.callbackQuery) {
        await ctx.editMessageText(message, {
            parse_mode: 'HTML',
            reply_markup: taskKeyboard
        });
    } else {
        await ctx.reply(message, {
            parse_mode: 'HTML',
            reply_markup: taskKeyboard
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

    const tone = getTone(user.currentWeek);
    if (ctx.callbackQuery.message.text && ctx.callbackQuery.message.text.startsWith("Задача:")) {
        await ctx.editMessageText(`${ctx.callbackQuery.message.text.split('\n')[0]}\n\n<b>Выполнена ✅</b>`, { parse_mode: 'HTML' });
    } else {
        await ctx.reply(`<b>Сэнсэй:</b> ${tone.praise}`, { parse_mode: 'HTML' });
        try {
            await handleTasks(ctx);
        } catch (e) {
            if (e.description?.includes("message is not modified")) return;
            console.error(e);
        }
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

export const handleAddTaskCallback = async (ctx) => {
    const action = ctx.match[0] || ctx.match;
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
        const todayStr = now.toFormat('yyyy-MM-dd');
        await ctx.editMessageText("Выбери дату на календаре:", {
            reply_markup: createCalendarKeyboard(now.year, now.month, todayStr)
        });
    }

    await ctx.answerCallbackQuery();
};

export const handleCalendarNav = async (ctx) => {
    const [year, month] = ctx.match[1].split('_').map(Number);
    const user = await User.findOne({ telegramId: ctx.from.id });
    if (!user) return;
    
    const now = DateTime.now().setZone(user.timezone || 'Europe/Kyiv');
    const todayStr = now.toFormat('yyyy-MM-dd');
    
    await ctx.editMessageText("Выбери дату на календаре:", {
        reply_markup: createCalendarKeyboard(year, month, todayStr)
    });
    await ctx.answerCallbackQuery();
};

export const handleSetDateCallback = async (ctx) => {
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

    const formattedDate = DateTime.fromISO(dateStr).setLocale('ru').toFormat('d MMMM yyyy года');

    await ctx.answerCallbackQuery({ text: "Задача добавлена!" });
    await ctx.editMessageText(`Задача «<b>${newTask.title}</b>» добавлена на <b>${formattedDate}</b>.`, { parse_mode: 'HTML' });

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
            return ctx.answerCallbackQuery({ text: "Пояснение пока не готово." });
        } else {
            return ctx.reply("Пояснение пока не готово.");
        }
    }

    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    await ctx.reply(`<b>📚 ПОЯСНЕНИЕ К НЕДЕЛЕ ${user.currentWeek}</b>\n\n${weekData.lecture_notes}`, { parse_mode: 'HTML' });
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

    const routineStatusText = buildRoutineStatusText(user, weekData, todayStr, user.currentWeek);
    const currentTimeStr = dt.toFormat('HH:mm');
    const enrichedRoutineStatus = `Текущее время: ${currentTimeStr}\n${routineStatusText}`;

    const loadingMsg = await ctx.reply("⏳ <b>Сэнсэй анализирует...</b>", { parse_mode: 'HTML' });

    const geminiResult = await geminiService.processUserMessage(contentParts, user.currentWeek, enrichedRoutineStatus);

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

    const isMenuButton = ["⚙️ Настройки", "📚 Задания", "📈 Прогресс", "ℹ️ Помощь и Правила", "📚 Пояснение заданий", "📜 Правила игры", "🔙 Назад"].includes(text);
    if (isMenuButton && user.isMessagingAdmin) {
        user.isMessagingAdmin = false;
        await user.save();
    }

    if (text === "⚙️ Настройки") return handleSettings(ctx);
    if (text === "📚 Задания") return handleTasks(ctx);
    if (text === "📈 Прогресс") return handleProgress(ctx);
    if (text === "👥 Активные юзеры" && isCreator) {
        const activeCount = await User.countDocuments({ frozen: false });
        return ctx.reply(`<b>[АДМИН-ПАНЕЛЬ]</b>\n\nКоличество активных подопечных: <b>${activeCount}</b>`, { parse_mode: 'HTML' });
    }
    if (text === "ℹ️ Помощь и Правила") {
        return ctx.reply("База знаний. Здесь ты можешь прочитать теорию текущей недели, вспомнить правила бота или написать админу. А чтобы задать вопрос мне — просто напиши обычное сообщение.", {
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

    if (text === "📚 Пояснение заданий") return handleShowLectureCallback(ctx);

    if (text === "📜 Правила игры") {
        const rulesText = `<b>📜 ПРАВИЛА ИГРЫ:</b>\n\n1. <b>Задания:</b> Жми «📚 Задания» внизу. Там твой план на неделю: ежедневная рутина и глобальные цели. Рутину отмечай прямо там кнопками со статусами.\n2. <b>Отчеты:</b> Каждый вечер присылай мне <b>отчет</b> (текстом или голосовым). Расскажи, что сделал за день по рутине и какие глобальные задачи закрыл. Я оценю твой прогресс.\n3. <b>Переход на новую неделю:</b> Чтобы перейти, нужно закрыть <b>все</b> глобальные задачи и <b>хотя бы 1 день</b> выполнить рутину на 100%.\n4. <b>Наказания:</b> За игнор отчетов, невыполнение или нытье — даю страйки. 5 страйков — заморозка бота на 24 часа.\n\n<i>Остались вопросы? Просто напиши мне сообщение текстом/голосом, либо напиши админу (@pirial_mersus), он всё разъяснит.</i>`;
        return ctx.reply(rulesText, { parse_mode: 'HTML' });
    }

    if (text === "✍️ Написать админу") {
        user.isMessagingAdmin = true;
        await user.save();
        return ctx.reply("Пиши свое сообщение админу. Я перешлю как есть. Только не спамь.");
    }

    if (text === "🔙 Назад") {
        const isCreatorForMenu = user.telegramId.toString() === process.env.CREATOR_ID;
        return ctx.reply("Возвращаю в главное меню. Не расслабляйся.", {
            reply_markup: createMainMenuKeyboard(isCreatorForMenu)
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

const handlePhoto = async (ctx) => {
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
        return ctx.reply("Фото для админа пока не поддерживаются. Напиши текстом.");
    }

    try {
        const photoSizes = ctx.message.photo;
        if (!photoSizes || photoSizes.length === 0) return ctx.reply("Не удалось получить фото.");

        const largestPhoto = photoSizes[photoSizes.length - 1];
        const file = await ctx.api.getFile(largestPhoto.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

        const photoBase64 = await downloadFileAsBase64(fileUrl);

        const captionText = ctx.message.caption || '';
        if (user.currentWeek === 2 && captionText.toLowerCase().includes('контракт')) {
            user.contractFileId = largestPhoto.file_id;
            await user.save();
        }

        const contentParts = [
            {
                inlineData: {
                    mimeType: 'image/jpeg',
                    data: photoBase64
                }
            },
            captionText
                ? `Подопечный прислал фото с подписью: "${captionText}". Проанализируй изображение и текст.`
                : "Подопечный прислал фото без подписи. Проанализируй изображение и определи, что он хочет показать."
        ];

        const originalText = captionText ? `[Фото] ${captionText}` : "[Фото]";
        await sendToGeminiAndRespond(ctx, user, contentParts, originalText);
    } catch (error) {
        console.error("Photo processing error:", error);
        await ctx.reply("Ошибка при обработке фото. Попробуй ещё раз или опиши словами.");
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
    handleCustomTaskCallback, handleShowLectureCallback, handleRemindLaterCallback,
    handleText, handleVoice, handlePhoto, handleMyChatMember
};