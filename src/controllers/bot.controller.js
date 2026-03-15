import User from '../models/User.js';
import Report from '../models/Report.js';
import methodology from '../data/methodology.js';
import { InlineKeyboard } from 'grammy';
import { DateTime } from 'luxon';
import * as geminiService from '../services/gemini.js';
import { createSettingsKeyboard, createTimezoneRegionsKeyboard, createTimezoneCitiesKeyboard } from '../keyboards/settings.js';
import { createMainMenuKeyboard, createHelpMenuKeyboard } from '../keyboards/menus.js';

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

    let text = `<b>📈 ПРОГРЕСС</b>\n\nНеделя: ${user.currentWeek} | День: ${user.currentDay}\n`;
    text += `Задач на сегодня выполнено: ${doneTasks} из ${totalTasks}\n`;
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

    let message = `<b>${weekData.title}</b>\n\n`;
    message += `<b>Ежедневная рутина:</b>\n`;
    weekData.daily_routine.forEach(t => {
        const isDone = user.progress?.get(`${t.id}_${todayStr}`);
        message += `${isDone ? '✅' : '❌'} ${t.title}\n`;
    });

    message += `\n<b>Глобальные задачи недели:</b>\n`;
    weekData.global_tasks?.forEach(t => {
        message += `🔥 ${t.title}\n`;
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

    await ctx.reply(message, {
        parse_mode: 'HTML',
        reply_markup: hasTaskButtons ? taskKeyboard : undefined
    });
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
        console.error(e);
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

const handleText = async (ctx) => {
    const user = await User.findOne({ telegramId: ctx.from.id });
    if (!user) return ctx.reply("Жми /start.");
    const isCreator = user.telegramId.toString() === process.env.CREATOR_ID;
    if (user.frozen && !isCreator) return ctx.reply("Замороженные права голоса не имеют.");

    const text = ctx.message.text;

    if (text === "⚙️ Настройки") return handleSettings(ctx);
    if (text === "📚 Задания") return handleTasks(ctx);
    if (text === "📈 Прогресс") return handleProgress(ctx);
    if (text === "🧘 Сэнсэй, помоги!") {
        return ctx.reply("Это раздел помощи. Здесь ты можешь изучить теорию текущей недели или задать вопрос Сэнсэю напрямую.", {
            reply_markup: createHelpMenuKeyboard()
        });
    }

    if (text === "📚 Конспект лекции") return handleShowLectureCallback(ctx);

    if (text === "❓ Задать вопрос") {
        user.isAskingHelp = true;
        await user.save();
        return ctx.reply("Излагай. Только помни: нытье = 50 отжиманий.");
    }

    if (text === "🔙 Назад") {
        return ctx.reply("Возвращаю в главное меню. Не расслабляйся.", {
            reply_markup: createMainMenuKeyboard()
        });
    }

    if (user.currentWeek === 8) {
        const eurMatch = text.match(/^\s*(\d+)\s*(евро|eur|€)?\s*$/i);
        if (eurMatch) {
            user.socialCapitalEur = parseInt(eurMatch[1], 10);
            await user.save();
            return ctx.reply(`<b>Цена твоего слова:</b> ${user.socialCapitalEur} евро зафиксирована.`, { parse_mode: 'HTML' });
        }
    }

    if (text.length > 50) {
        const loadingMsg = await ctx.reply("⏳ Читаю твою писанину. Жди...");

        let feedback = await geminiService.analyzeReport(text, user.currentWeek);
        if (!feedback) feedback = "Система сбоит. [ОШИБКА]";

        const isApproved = feedback.includes("[ПРИНЯТО]");
        const resultText = `Вердикт ИИ-тренера:\n${feedback}`;

        await ctx.api.editMessageText(ctx.chat.id, loadingMsg.message_id, resultText, { parse_mode: 'HTML' });

        if (isApproved) {
            const newReport = new Report({
                userId: user._id,
                week: user.currentWeek,
                day: user.currentDay,
                text: text,
                geminiFeedback: feedback,
                status: 'approved'
            });
            await newReport.save();

            // Извлекаем выполненные задачи
            const completedMatch = feedback.match(/\[COMPLETED: (.*?)\]/);
            if (completedMatch) {
                const taskIds = completedMatch[1].split(',').map(id => id.trim());
                taskIds.forEach(id => {
                    if (!user.completedGlobalTasks.includes(id)) {
                        user.completedGlobalTasks.push(id);
                    }
                });
            }

            // Проверяем рутину на 100% за сегодня
            const weekData = methodology.weeks[user.currentWeek];
            const dt = DateTime.now().setZone(user.timezone || 'Europe/Kyiv');
            const todayStr = dt.toFormat('yyyy-MM-dd');
            
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

            // Проверка условий перехода на новую неделю
            const allGlobalTasks = weekData.global_tasks?.map(t => t.id) || [];
            const isAllGlobalDone = allGlobalTasks.every(id => user.completedGlobalTasks.includes(id));
            const isAnyRoutineDone = user.totalRoutineDays >= 1;

            if (isAllGlobalDone && isAnyRoutineDone) {
                user.currentWeek += 1;
                user.currentDay = 1;
                user.completedGlobalTasks = [];
                user.totalRoutineDays = 0;
                await ctx.reply(`<b>ВНИМАНИЕ!</b> Ты закрыл все задачи. Неделя ${user.currentWeek} началась. Введи /tasks.`, { parse_mode: 'HTML' });
            } else {
                let statusMsg = "Засчитано. ";
                if (!isAllGlobalDone) statusMsg += `Остались хвосты по глобал-задачам. `;
                if (!isAnyRoutineDone) statusMsg += `Нужен хотя бы один день 100% рутины. `;
                await ctx.reply(`<b>Сэнсэй:</b> ${statusMsg}`, { parse_mode: 'HTML' });
            }
            await user.save();
        }

        if (feedback.includes('50 отжиманий')) {
            user.strikes = (user.strikes || 0) + 1;
            if (user.strikes >= 3) {
                user.frozen = true;
                user.unfreezeDate = DateTime.now().plus({ days: 1 }).toJSDate();
                await ctx.reply(`<b>ФИНИШ.</b> Ты заморожен на 24 часа за нытье.`, { parse_mode: 'HTML' });
            } else {
                await ctx.reply(`<b>СТРАЙК ЗА НЫТЬЕ!</b> У тебя ${user.strikes}/3. Еще косяк — и в бан.`, { parse_mode: 'HTML' });
            }
            await user.save();
        }
    } else {
        const isHelpRequest = user.isAskingHelp;
        if (isHelpRequest) {
            user.isAskingHelp = false;
            await user.save();
        }

        // Проверка бана перед обработкой текста
        if (user.frozen) {
            const now = DateTime.now().toJSDate();
            if (user.unfreezeDate && now >= user.unfreezeDate) {
                user.frozen = false;
                user.strikes = 0;
                user.unfreezeDate = null;
                await user.save();
            } else {
                return ctx.reply("Ты в бане. Жди.");
            }
        }

        const loadingMsg = await ctx.reply("⏳ <b>Сэнсэй анализирует...</b>", { parse_mode: 'HTML' });
        let replyText = await geminiService.chatWithMentor(text, user.currentWeek, isHelpRequest);

        try {
            await ctx.api.editMessageText(ctx.chat.id, loadingMsg.message_id, replyText, { parse_mode: 'HTML' });
        } catch (e) {
            await ctx.api.editMessageText(ctx.chat.id, loadingMsg.message_id, replyText);
        }

        if (replyText.includes('50 отжиманий')) {
            user.strikes = (user.strikes || 0) + 1;
            if (user.strikes >= 3) {
                user.frozen = true;
                user.unfreezeDate = DateTime.now().plus({ days: 1 }).toJSDate();
                await ctx.reply("<b>БАН ЗА НЫТЬЕ.</b> На 24 часа.", { parse_mode: 'HTML' });
            } else {
                await ctx.reply(`<b>СТРАЙК!</b> ${user.strikes}/3.`, { parse_mode: 'HTML' });
            }
            await user.save();
        }
    }
};

const handleMyChatMember = async (ctx) => {
    try {
        const newStatus = ctx.myChatMember.new_chat_member.status;
        if (newStatus === 'kicked') {
            const user = await User.findOne({ telegramId: ctx.from.id });
            if (user) {
                await Report.deleteMany({ userId: user._id });
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
    handleShowLectureCallback,
    handleText, handleMyChatMember
};