import User from '../models/User.js';
import Report from '../models/Report.js';
import CustomTask from '../models/CustomTask.js';
import Artifact from '../models/Artifact.js';
import methodology, { getFullDailyRoutine, getFullTaboo } from '../data/methodology.js';
import { InlineKeyboard } from 'grammy';
import { DateTime } from 'luxon';
import * as geminiService from '../services/gemini.js';
import { getTasksMessage } from '../services/task.service.js';
import { getTone } from '../utils/tone.js';
import { createSettingsKeyboard, createTimezoneRegionsKeyboard, createTimezoneCitiesKeyboard } from '../keyboards/settings.js';
import { createMainMenuKeyboard, createHelpMenuKeyboard } from '../keyboards/menus.js';
import { createCalendarKeyboard } from '../keyboards/calendar.js';
import { sendWeekWelcome } from '../services/welcome.service.js';
import https from 'https';
import http from 'http';

const messageBuffers = new Map();
const praiseBuffers = new Map();

const bufferPraise = async (ctx, user, text) => {
    const userId = ctx.from.id;
    if (praiseBuffers.has(userId)) {
        clearTimeout(praiseBuffers.get(userId));
    }
    const timer = setTimeout(async () => {
        praiseBuffers.delete(userId);
        await ctx.api.sendMessage(user.telegramId, `<b>Сэнсэй:</b> ${text}`, { parse_mode: 'HTML' });
    }, 4000);
    praiseBuffers.set(userId, timer);
};

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

const processGeminiResult = async (ctx, user, geminiResult, originalText, options = {}) => {
    if (geminiResult.isContractPhoto && options.photoId) {
        user.contractFileId = options.photoId;
        await user.save();
    }
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

    if (geminiResult.extractedArtifacts) {
        const art = geminiResult.extractedArtifacts;
        const types = [
            { key: 'desires', type: 'desires100' },
            { key: 'smart_goals', type: 'smartGoals10' },
            { key: 'strategic_goals', type: 'strategicGoals' },
            { key: 'tactical_goals', type: 'tacticalGoals' },
            { key: 'contract_text', type: 'contractText' },
            { key: 'analysis_of_situation', type: 'analysisOfCurrentSituation' },
            { key: 'weekly_report', type: 'weeklyReport' }
        ];

        for (const t of types) {
            const val = art[t.key];
            if (!val || (Array.isArray(val) && val.length === 0)) continue;

            let finalVal = val;
            if (t.type === 'desires100') {
                const existing = await Artifact.findOne({ userId: user._id, type: 'desires100' });
                const currentList = existing ? existing.value : [];
                finalVal = [...new Set([...currentList, ...val])];
            }

            if (t.type === 'weeklyReport') {
                const newReportArt = new Artifact({
                    userId: user._id,
                    type: 'weeklyReport',
                    value: finalVal,
                    week: user.currentWeek
                });
                await newReportArt.save();
                continue;
            }

            await Artifact.findOneAndUpdate(
                { userId: user._id, type: t.type },
                { value: finalVal, updatedAt: new Date() },
                { upsert: true, setDefaultsOnInsert: true }
            );
        }
    }

    if (geminiResult.exemptions && geminiResult.exemptions.length > 0) {
        for (const exemption of geminiResult.exemptions) {
            const alreadyExempted = user.exemptedTasks.some(existing => existing.taskId === exemption.task_id);
            if (!alreadyExempted) {
                user.exemptedTasks.push({
                    taskId: exemption.task_id,
                    reason: exemption.reason,
                    alternative: exemption.alternative
                });
            }
        }

        const exemptionMessages = geminiResult.exemptions.map(
            ex => `• <b>${ex.task_id}</b>: ${ex.reason}. Альтернатива: <i>${ex.alternative}</i>`
        );
        await sendLongMessage(ctx, `🩺 <b>Сэнсэй выдал освобождение:</b>\n\n${exemptionMessages.join('\n')}\n\n<i>Освобождение действует до конца текущей недели.</i>`, { parse_mode: 'HTML' });
    }

    if (geminiResult.isDailyReportAccepted) {
        user.progress = user.progress || new Map();
        user.progress.set(`daily_report_submitted_${todayStr}`, true);
        
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
            await sendLongMessage(ctx, `<b>Сэнсэй:</b> ${statusMsg}`, { parse_mode: 'HTML' });
        }
        await user.save();
    }

    if (geminiResult.hasWhiningPenalty) {
        const isCreator = user.telegramId.toString() === process.env.CREATOR_ID;
        if (isCreator) return; // Админ не получает страйки

        user.strikes = (user.strikes || 0) + 1;
        if (user.strikes >= 5) {
            user.frozen = true;
            user.unfreezeDate = DateTime.now().setZone(user.timezone || 'Europe/Kyiv').plus({ days: 1 }).toJSDate();
            await user.save();
            await ctx.reply(`<b>ФИНИШ. Ты заморожен на 24 часа за нытье.</b>`, { parse_mode: 'HTML' });
            if (user.contractFileId) {
                await ctx.replyWithPhoto(user.contractFileId, { caption: "<b>Вот твое обязательство.</b> Ты должен дойти до конца. 🦾", parse_mode: 'HTML' });
            }
        } else {
            const tone = getTone(user.currentWeek);
            await user.save();
            await ctx.reply(`<b>СТРАЙК ЗА НЫТЬЕ!</b> ${tone.strike} У тебя ${user.strikes}/5.`, { parse_mode: 'HTML' });
            if (user.contractFileId) {
                await ctx.replyWithPhoto(user.contractFileId, { caption: "<b>Вот твое обязательство.</b> Ты должен дойти до конца. 🦾", parse_mode: 'HTML' });
            }
        }
    }

    // Обработка запрошенных действий (отправка артефактов)
    if (geminiResult.requestedAction) {
        const action = geminiResult.requestedAction;
        const artifacts = await Artifact.find({ userId: user._id });
        const artMap = {};
        artifacts.forEach(a => artMap[a.type] = a.value);

        if (action === 'send_contract') {
            if (user.contractFileId) {
                await ctx.replyWithPhoto(user.contractFileId, { caption: "<b>Твой контракт.</b> Протокол требует дисциплины.", parse_mode: 'HTML' });
            } else if (artMap.contractText) {
                await ctx.reply(`📜 <b>Твой контракт:</b>\n<i>${artMap.contractText}</i>`, { parse_mode: 'HTML' });
            } else {
                await ctx.reply("В моих архивах нет твоего контракта. Сначала сдай его.");
            }
        } else if (action === 'send_desires' && artMap.desires100?.length > 0) {
            const text = `🎯 <b>Твои хотелки (${artMap.desires100.length}):</b>\n` + artMap.desires100.map((d, i) => `${i + 1}. ${d}`).join('\n');
            await sendLongMessage(ctx, text, { parse_mode: 'HTML' });
        } else if (action === 'send_smart_goals' && artMap.smartGoals10?.length > 0) {
            const text = `✅ <b>SMART-цели:</b>\n` + artMap.smartGoals10.map((g, i) => `${i + 1}. ${g}`).join('\n');
            await sendLongMessage(ctx, text, { parse_mode: 'HTML' });
        } else if (action === 'send_strategy' && artMap.strategicGoals) {
            await sendLongMessage(ctx, `🌍 <b>Стратегия 2029:</b>\n${artMap.strategicGoals}`, { parse_mode: 'HTML' });
        } else if (action === 'send_tactics' && artMap.tacticalGoals) {
            await sendLongMessage(ctx, `📈 <b>Тактика 2026:</b>\n${artMap.tacticalGoals}`, { parse_mode: 'HTML' });
        } else if (action === 'send_analysis' && artMap.analysisOfCurrentSituation) {
            await sendLongMessage(ctx, `🔍 <b>Анализ ситуации:</b>\n${artMap.analysisOfCurrentSituation}`, { parse_mode: 'HTML' });
        } else if (action === 'send_weekly_reports') {
            const reports = await Artifact.find({ userId: user._id, type: 'weeklyReport' }).sort({ week: 1 });
            if (reports.length > 0) {
                const rText = reports.map(r => `🗓 <b>Неделя ${r.week}:</b>\n${r.value}`).join('\n\n---\n\n');
                await sendLongMessage(ctx, `📊 <b>История твоих недельных отчетов:</b>\n\n${rText}`, { parse_mode: 'HTML' });
            } else {
                await ctx.reply("В архивах пока нет твоих недельных отчетов. Сдай первый в ближайшее воскресенье.");
            }
        }
    }
}

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

        await ctx.reply(`Добро пожаловать в «Систему» — алгоритм твоей трансформации. 🧠💻\n\nЭтот тренинг базируется на принципах нейропластичности и теории систем. Мы не просто меняем привычки, мы меняем структуру твоего взаимодействия с миром.\n\nЭффективность курса (12 недель):\n\n<b>Репрограммирование:</b> Взлом «автопилота» мозга через смену маршрутов и новые привычки.\n<b>Биохакинг:</b> Оптимизация физического состояния для максимального когнитивного ресурса.\n<b>Социальный резонанс:</b> Использование теории сетей для повышения твоего статуса.\n\nЭто логичный, сухой и гарантированный путь к результату, если соблюдать протокол. 📊\n\nИзучи методологию и приступай к первому этапу: Идентификация.\n\n❗️ <b>Обязательно прочитай «📜 Правила игры» в разделе «ℹ️ Помощь и Правила».</b>`, { reply_markup: keyboard, parse_mode: 'HTML' });

        user.isSettingFocusArea = true;
        await user.save();
        await ctx.reply("Прежде чем мы начнем, скажи: <b>над чем ты хочешь поработать больше всего?</b>\n\nЭто может быть глобальная сфера (Деньги, Отношения, Здоровье) или конкретная задача на ближайшее время (Научиться водить, Выучить язык).\n\nЯ буду присылать тебе персональные напоминания от Сэнсэя, чтобы ты всегда держал это в фокусе.", { parse_mode: 'HTML' });
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
        await bufferPraise(ctx, user, tone.praise);
        try {
            await handleTasks(ctx);
        } catch (e) {
            if (e.description?.includes("message is not modified")) return;
            console.error(e);
        }
    }
};

const handleSubmitReportStartCallback = async (ctx) => {
    await ctx.reply("<b>Отчёт за день.</b>\nПришли мне текстовое или голосовое сообщение с итогами дня. Что сделано? Где просадка? Какое состояние?", { parse_mode: 'HTML' });
    await ctx.answerCallbackQuery();
};

const handleSubmitWeeklyReportCallback = async (ctx) => {
    await ctx.reply("<b>ИТОГ ПУТИ ЗА НЕДЕЛЮ.</b>\nПришли мне развернутый отчет за всю неделю. Какие главные победы? Какие осознания? Ты стал сильнее или просто топтался на месте?", { parse_mode: 'HTML' });
    await ctx.answerCallbackQuery();
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
            await bufferPraise(ctx, user, "Личная дисциплина — основа стержня. Красава.");
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
    } else if (action === 'focus') {
        const user = await User.findOne({ telegramId: ctx.from.id });
        user.isSettingFocusArea = true;
        await user.save();
        await ctx.editMessageText(`⚡️ <b>Твой фокус внимания — это твоя суперсила.</b>\n\nСэнсэй будет раз в день присылать тебе персональный совет или вопрос, основанный на твоей текущей цели, чтобы ты не „засыпал“ в рутине.\n\n<b>Над чем ты работаешь сейчас?</b>\nЭто может быть:\n— Сфера (Деньги, Отношения, Тело, Осознанность)\n— Конкретное дело (Выучить 100 слов, Сдать проект, Научиться водить)\n\nНапиши ответ одним сообщением, и Сэнсэй включит это в твой протокол.`, { parse_mode: 'HTML' });
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

const bufferContent = async (ctx, user, part, originalText) => {
    const userId = ctx.from.id;
    const now = new Date();

    if (!messageBuffers.has(userId)) {
        if (user.lastGeminiCall) {
            const diffMs = now - user.lastGeminiCall;
            if (diffMs < 60000) {
                const waitSec = Math.ceil((60000 - diffMs) / 1000);
                return ctx.reply(`⚠️ <b>Сэнсэй занят.</b> Подожди ${waitSec} сек. Не части, я не справочное бюро.`, { parse_mode: 'HTML' });
            }
        }

        messageBuffers.set(userId, {
            parts: [],
            originalTexts: [],
            timer: null,
            ctx: ctx,
            user: user
        });
    }

    const buffer = messageBuffers.get(userId);
    buffer.parts.push(part);
    if (originalText) buffer.originalTexts.push(originalText);
    buffer.ctx = ctx;

    if (buffer.timer) clearTimeout(buffer.timer);

    buffer.timer = setTimeout(async () => {
        const finalBuffer = messageBuffers.get(userId);
        if (!finalBuffer) return;
        messageBuffers.delete(userId);

        const combinedText = finalBuffer.originalTexts.join('\n\n');
        await sendToGeminiAndRespond(finalBuffer.ctx, finalBuffer.user, finalBuffer.parts, combinedText);
    }, 1000);
};

const sendToGeminiAndRespond = async (ctx, user, contentParts, originalText, options = {}) => {
    user.lastGeminiCall = new Date();
    await user.save();

    const weekData = methodology.weeks[user.currentWeek];
    const dt = DateTime.now().setZone(user.timezone || 'Europe/Kyiv');
    const todayStr = dt.toFormat('yyyy-MM-dd');

    const routineStatusText = buildRoutineStatusText(user, weekData, todayStr, user.currentWeek);
    const currentTimeStr = dt.toFormat('HH:mm');
    const enrichedRoutineStatus = `Текущее время: ${currentTimeStr}\n${routineStatusText}`;

    const loadingMsg = await ctx.reply("⏳ <b>Сэнсэй анализирует...</b>", { parse_mode: 'HTML' });

    const artifacts = await Artifact.find({ userId: user._id });
    const existingMap = {};
    artifacts.forEach(a => existingMap[a.type] = a.value);

    const existingArtifacts = {
        desires100: existingMap.desires100 || [],
        smartGoals10: existingMap.smartGoals10 || [],
        contractText: existingMap.contractText || '',
        strategicGoals: existingMap.strategicGoals || '',
        tacticalGoals: existingMap.tacticalGoals || '',
        analysisOfCurrentSituation: existingMap.analysisOfCurrentSituation || '',
        weeklyReports: artifacts.filter(a => a.type === 'weeklyReport').map(a => ({ week: a.week, value: a.value }))
    };

    // Если сегодня НЕ воскресенье, скрываем задачу weekly_report из списка для Gemini
    if (dt.weekday !== 7) {
        weekData.global_tasks = weekData.global_tasks?.filter(t => t.id !== 'weekly_report') || [];
    }

    const geminiResult = await geminiService.processUserMessage(contentParts, user.currentWeek, enrichedRoutineStatus, existingArtifacts);

    if (!geminiResult.responseText || geminiResult.responseText.trim() === "") {
        try {
            await ctx.api.deleteMessage(ctx.chat.id, loadingMsg.message_id);
        } catch (e) {
            console.error("Failed to delete loading message:", e.message);
        }
    } else if (geminiResult.responseText.length > 4000) {
        try {
            await ctx.api.deleteMessage(ctx.chat.id, loadingMsg.message_id);
        } catch (e) {
            console.error("Failed to delete loading message:", e.message);
        }
        await sendLongMessage(ctx, geminiResult.responseText, { parse_mode: 'HTML' });
    } else {
        try {
            await ctx.api.editMessageText(ctx.chat.id, loadingMsg.message_id, geminiResult.responseText, { parse_mode: 'HTML' });
        } catch (e) {
            try {
                await ctx.api.editMessageText(ctx.chat.id, loadingMsg.message_id, geminiResult.responseText);
            } catch (e2) {
                console.error("Failed to edit loading message:", e2.message);
            }
        }
    }

    await processGeminiResult(ctx, user, geminiResult, originalText, options);
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

    const lowerText = (text || "").toLowerCase();

    // Обработка установки сферы интересов (Onboarding)
    if (user.isSettingFocusArea) {
        user.focusArea = text.trim();
        user.isSettingFocusArea = false;
        await user.save();
        await ctx.reply(`Понял тебя. Твой фокус зафиксирован: <b>${user.focusArea}</b>.\nЯ буду использовать это, чтобы возвращать твое внимание к самому важному.`, { parse_mode: 'HTML' });
        await ctx.reply("Теперь ты в системе. Используй меню для навигации.", { reply_markup: createMainMenuKeyboard(isCreator) });

        if (user.currentWeek === 1) {
            await sendWeekWelcome(ctx, user, { includeTasks: true });
        }
        return;
    }

    // Обработка установки недели админом
    if (user.isSettingWeek && isCreator) {
        const weekNum = parseInt(text);
        if (!isNaN(weekNum) && weekNum >= 1 && weekNum <= 12) {
            user.currentWeek = weekNum;
            user.currentDay = 1;
            user.completedGlobalTasks = [];
            user.totalRoutineDays = 0;
            user.isReadyForNextWeek = false;
            user.strikes = 0;
            user.exemptedTasks = [];
            user.isSettingWeek = false;
            await user.save();

            await sendWeekWelcome(ctx, user, { includeTasks: true });
        } else {
            await ctx.reply("❌ Некорректный номер недели. Введи число от 1 до 12.");
        }
        return;
    }

    if (text === "📅 Выставить неделю" && isCreator) {
        user.isSettingWeek = true;
        await user.save();
        await ctx.reply("Введи номер недели (1-12):", { reply_markup: { remove_keyboard: true } });
        return;
    }

    if (text === "🧪 Тест напоминания" && isCreator) {
        if (!user.focusArea) {
            await ctx.reply("⚠️ У тебя не установлена сфера интересов. Сначала установи её.");
            return;
        }
        await ctx.reply("⌛️ Генерирую тестовое напоминание...");
        const tone = getTone(user.currentWeek);
        const reminder = await geminiService.generateFocusReminder(user.focusArea, user.currentWeek, tone);
        await ctx.reply(`🔔 <b>Тестовое напоминание (Фокус: ${user.focusArea}):</b>\n\n${reminder}`, { parse_mode: 'HTML' });
        return;
    }

    const isMenuButton = ["⚙️ Настройки", "📚 Задания", "📈 Прогресс", "ℹ️ Помощь и Правила", "📚 Пояснение заданий", "📜 Правила игры", "🔙 Назад"].includes(text);
    if (isMenuButton && user.isMessagingAdmin) {
        user.isMessagingAdmin = false;
        await user.save();
    }

    if (text === "⚙️ Настройки") return handleSettings(ctx);
    if (text === "📚 Задания") return handleTasks(ctx);
    if (text === "📈 Прогресс") return handleProgress(ctx);
    if (text === "👥 Активные юзеры" && isCreator) {
        const stats = await User.aggregate([
            { $match: { frozen: false } },
            { $group: { _id: "$currentWeek", count: { $sum: 1 } } },
            { $sort: { _id: 1 } }
        ]);

        const totalActive = stats.reduce((acc, s) => acc + s.count, 0);
        let statsMsg = `<b>[АДМИН-ПАНЕЛЬ]</b>\n\nВсего активных: <b>${totalActive}</b>\n\n`;

        if (stats.length > 0) {
            stats.forEach(s => {
                statsMsg += `Неделя ${s._id}: <b>${s.count}</b>\n`;
            });
        } else {
            statsMsg += "В системе пока нет активных подопечных.";
        }

        return ctx.reply(statsMsg, { parse_mode: 'HTML' });
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

    await bufferContent(ctx, user, text, text);
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

        await bufferContent(ctx, user, {
            inlineData: {
                mimeType: mimeType,
                data: audioBase64
            }
        }, "[Аудиосообщение]");
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

        if (captionText) {
            await bufferContent(ctx, user, `Подопечный прислал фото с подписью: "${captionText}". Проанализируй изображение и текст.`, `[Фото] ${captionText}`);
        } else {
            await bufferContent(ctx, user, "Подопечный прислал фото без подписи. Проанализируй изображение и определи, что он хочет показать.", "[Фото]");
        }

        await bufferContent(ctx, user, {
            inlineData: {
                mimeType: 'image/jpeg',
                data: photoBase64
            }
        });
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
    handleText, handleVoice, handlePhoto, handleMyChatMember,
    handleSubmitReportStartCallback, handleSubmitWeeklyReportCallback
};