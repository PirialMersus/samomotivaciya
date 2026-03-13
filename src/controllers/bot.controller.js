import User from '../models/User.js';
import Report from '../models/Report.js';
import tasksConfig from '../data/tasks.js';
import * as geminiService from '../services/gemini.js';
import methodology from '../data/methodology.js';
import { InlineKeyboard } from 'grammy';
import { DateTime } from 'luxon';
import { createSettingsKeyboard, createTimezoneRegionsKeyboard, createTimezoneCitiesKeyboard } from '../keyboards/settings.js';


const emojis = ['🔥', '⚡️', '💪', '🎯', '🛠', '⚠️', '🚀', '🧠'];
const formatTaskForMarkdown = (tasksString) => {
    return tasksString
        .split(/(?<=[.?!])\s+/)
        .filter(sentence => sentence.trim().length > 0)
        .map((sentence, index) => {
            const emoji = emojis[index % emojis.length];
            return `${emoji} *${sentence.trim()}*`;
        })
        .join('\n\n');
};

const handleStart = async (ctx) => {
    const telegramId = ctx.from.id;
    const username = ctx.from.username || '';
    const isCreator = telegramId.toString() === process.env.CREATOR_ID;

    const keyboard = {
        keyboard: [
            [{ text: "📚 Задания" }, { text: "📈 Прогресс" }],
            [{ text: "🧘 Сэнсэй, помоги!" }, { text: "⚙️ Настройки" }]
        ],
        resize_keyboard: true
    };

    let user = await User.findOne({ telegramId });

    if (!user) {
        user = new User({ telegramId, username, isRegistered: true });
        await user.save();
        await ctx.reply(`Добро пожаловать в ад, ${username || 'салага'}. Я твой ментор на ближайшие 11 недель. Никаких поблажек. Никаких соплей. Выполняешь задания вовремя — двигаешься дальше. Опоздал хотя бы на секунду после 00:00 — заморозка. Твоя первая неделя началась.`, { reply_markup: keyboard });
    } else if (user.frozen && !isCreator) {
        await ctx.reply("Куда ты лезешь? Ты заморожен за невыполнение требований. Жди, пока я решу, что с тобой делать, или связывайся с администрацией.");
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

// Старые текстовые команды (контракты, центровки) удалены.

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
        message += `\n⚠️ <b>БОЛЬШАЯ ЧИСТКА:</b>\nЗавершение ВСЕХ хвостов за недели 1-4. Проверка на целостность. Убедись, что закрыл старые задачи.\n`;
    }

    if (weekData.special_tasks && weekData.special_tasks.length > 0) {
        message += `\n<b>Спецзадания (просто помни о них):</b>\n`;
        weekData.special_tasks.forEach(t => {
            message += `🛠 ${t.title}\n`;
        });
    }

    if (weekData.taboo && weekData.taboo.length > 0) {
        message += `\n<b>Табу:</b>\n${weekData.taboo.join(', ')}`;
    }

    // Генерируем кнопки для невыполненных задач
    const keyboard = new InlineKeyboard();
    let hasButtons = false;
    weekData.daily_routine.forEach(t => {
        const isDone = user.progress?.get(`${t.id}_${todayStr}`);
        if (!isDone) {
            keyboard.text(`Сделал ✅: ${t.title}`, `done:${t.id}`).row();
            hasButtons = true;
        }
    });

    await ctx.reply(message, {
        parse_mode: 'HTML',
        reply_markup: hasButtons ? keyboard : undefined
    });
};

const handleTaskDoneCallback = async (ctx) => {
    const taskId = ctx.match[1];
    const user = await User.findOne({ telegramId: ctx.from.id });
    if (!user) return;

    const dt = DateTime.now().setZone(user.timezone || 'Europe/Kyiv');
    const todayStr = dt.toFormat('yyyy-MM-dd');

    if (!user.progress) {
        user.progress = new Map();
    }
    
    const progressKey = `${taskId}_${todayStr}`;
    if (user.progress.get(progressKey)) {
        await ctx.answerCallbackQuery({ text: "Уже отмечено, боец!" });
        return;
    }

    user.progress.set(progressKey, true);
    await user.save();

    await ctx.answerCallbackQuery({ text: "Принято!" });
    await ctx.reply(`<b>Сэнсэй:</b> Хвалю за дисциплину! Ты выполнил задачу. Продолжай в том же духе.`, { parse_mode: 'HTML' });

    // Обновляем сообщение (удаляем кнопку)
    try {
        await handleTasks(ctx); // Простой вариант: прислать обновленный список
    } catch(e) {
        console.error(e);
    }
};

const handleRemindLaterCallback = async (ctx) => {
    try {
        await ctx.answerCallbackQuery({ text: "Принято. Время идет." });
        await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    } catch (e) {
        console.error(e);
    }
};

const handleSettings = async (ctx) => {
    const user = await User.findOne({ telegramId: ctx.from.id });
    if (!user) return ctx.reply("Сначала нажми /start.");
    
    await ctx.reply(`Настройки задания:\nТекущий часовой пояс: <b>${user.timezone}</b>\n\nВыбери, что хочешь изменить:`, {
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
        await ctx.editMessageText(`Настройки задания:\nТекущий часовой пояс: <b>${user.timezone}</b>\n\nВыбери, что хочешь изменить:`, {
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

    if (!user) return ctx.reply("Жми /start и не пиши мне просто так.");
    const isCreator = user.telegramId.toString() === process.env.CREATOR_ID;
    if (user.frozen && !isCreator) return ctx.reply("Замороженные права голоса не имеют.");

    const text = ctx.message.text;

    if (text === "⚙️ Настройки") {
        return handleSettings(ctx);
    }
    if (text === "📚 Задания") {
        return handleTasks(ctx);
    }
    if (text === "📈 Прогресс") {
        return handleProgress(ctx);
    }
    if (text === "🧘 Сэнсэй, помоги!") {
        user.isAskingHelp = true;
        await user.save();
        return ctx.reply("Излагай, что у тебя там? Только помни: нытье = 50 отжиманий.");
    }

    if (user.currentWeek === 8) {
        const eurMatch = text.match(/^\s*(\d+)\s*(евро|eur|€)?\s*$/i) || text.match(/(?:собрал|сумма).*?\s+(\d+)\s*(?:евро|eur|€)?/i);
        if (eurMatch) {
            const amount = parseInt(eurMatch[1], 10);
            user.socialCapitalEur = amount;
            await user.save();
            return ctx.reply(`<b>Цена твоего слова:</b> ${amount} евро зафиксирована. Если это ноль — делай выводы.`, { parse_mode: 'HTML' });
        }
    }

    if (user.currentWeek === 9) {
        const auditMatch = text.match(/(?:выписал|аудит|убеждений|нашел|записал).*?\s+(\d+)\s*(?:убеждени[яей]|штук|шт)?/i) || text.match(/^\s*(?:аудит|убеждений)?\s*(\d+)\s*(?:убеждени[яей]|штук|шт)?\s*$/i);
        if (auditMatch) {
            const amount = parseInt(auditMatch[1], 10);
            user.auditBeliefsCount = amount;
            await user.save();
            return ctx.reply(`<b>Аудит ограничений:</b> зафиксировано поиск <b>${amount}</b> убеждений. Раскапывай базу дальше.`, { parse_mode: 'HTML' });
        }
    }

    if (user.currentWeek === 10) {
        const mentorMatch = text.match(/(?:наставник|ментор)\s*(?:найден|есть|да|\+)/i);
        const autoMentorMatch = text.match(/(?:наставник|ментор)(.*?)(?:нашел|договорился)/i);
        if (mentorMatch || autoMentorMatch) {
            user.hasMentor = true;
            await user.save();
            return ctx.reply(`<b>СТРАТЕГ:</b> Отлично. Наставник зафиксирован. Впитывай знания как губка. Обучение ускорит твой прогресс.`, { parse_mode: 'HTML' });
        }
        const noMentorMatch = text.match(/(?:наставник|ментор)\s*(?:нет|минус|\-)/i);
        if (noMentorMatch) {
            user.hasMentor = false;
            await user.save();
            return ctx.reply(`<b>СТРАТЕГ:</b> Плохо. Без наставника ты теряешь годы. Ищи активнее, не экономь на мозгах.`, { parse_mode: 'HTML' });
        }

        const followersMatch = text.match(/(?:ученик[ои]?в?|последовател[ейи]?|обучаю).*?\s+(\d+)\s*(?:человек|штук|шт)?/i);
        if (followersMatch) {
            const amount = parseInt(followersMatch[1], 10);
            user.followersCount = amount > 3 ? 3 : amount; // Capping at 3 as per task
            await user.save();
            return ctx.reply(`<b>СТРАТЕГ:</b> Ученики зафиксированы (${user.followersCount}/3). Учи их жестко, но по делу. Так ты лучше поймешь себя.`, { parse_mode: 'HTML' });
        }
    }

    // Если это похоже на отчет (длиннее 50 символов - грубая эвристика)
    if (text.length > 50) {
        const loadingMsg = await ctx.reply("⏳ Читаю твою писанину. Жди...");

        let feedback = await geminiService.analyzeReport(text, user.currentWeek);
        if (!feedback || feedback.trim() === '') {
            feedback = "Система сбоит. Твой жалкий отчет пока не проверен. Продолжай страдать и ждать. [ОШИБКА]";
        }

        if (feedback.includes("[ПРИНЯТО]")) {
            await ctx.api.editMessageText(ctx.chat.id, loadingMsg.message_id, `Вердикт ИИ-тренера:\n${feedback}\n\nГреби дальше. Отчет за этот день принят.`);

            const newReport = new Report({
                userId: user._id,
                week: user.currentWeek,
                day: user.currentDay,
                text: text,
                geminiFeedback: feedback,
                status: 'approved'
            });
            await newReport.save();

            // Продвигаем юзера (упрощенная логика)
            user.currentDay += 1;
            if (user.currentDay > 7) {
                user.currentWeek += 1;
                user.currentDay = 1;

                if (user.currentWeek > Object.keys(methodology.weeks).length) {
                    await ctx.reply("Не верю своим глазам. Ты дошел до конца. Вали отсюда и делай что-то полезное со своей жизнью.");
                } else {
                    await ctx.reply(`Неделя ${user.currentWeek} началась. Введи /tasks чтобы увидеть новые цели.`);
                }
            }
            await user.save();
        } else {
            await ctx.api.editMessageText(ctx.chat.id, loadingMsg.message_id, `Вердикт ИИ-тренера:\n${feedback}\n\nТвой отчет - мусор. Переделывай. И если я не увижу нормального отчета до полуночи, ты заморожен.`);
        }

        if (feedback.includes('50 отжиманий')) {
            user.strikes = (user.strikes || 0) + 1;
            if (user.strikes >= 3) {
                user.frozen = true;
                await ctx.reply("<b>ФИНИШ.</b> Ты набрал 3 страйка (нытье или провалы). Ты заморожен и лишен голоса в этом чате. Переходи в оффлайн-режим.", { parse_mode: 'HTML' });
            } else {
                await ctx.reply(`<b>СТРАЙК ЗА НЫТЬЕ!</b> У тебя ${user.strikes} страйка(ов) из 3. Дальше — бан.`, { parse_mode: 'HTML' });
            }
            await user.save();
        }
    } else {
        // Обычное общение с тренером и ответы на вопросы
        const isHelpRequest = user.isAskingHelp;
        if (isHelpRequest) {
            user.isAskingHelp = false;
            await user.save();
        }

        const loadingMsg = await ctx.reply("⏳ <b>Сэнсэй анализирует твой выпад...</b>", { parse_mode: 'HTML' });
        
        let replyText = await geminiService.chatWithMentor(text, user.currentWeek, isHelpRequest);
        if (!replyText || replyText.trim() === '') {
            replyText = "У меня нет слов от твоей глупости. Иди работай.";
        }
        
        // Sanitize any stray asterisks just in case
        replyText = replyText.replace(/\*\*/g, '');

        // Remove unsupported HTML tags that Gemini might still generate
        replyText = replyText
            .replace(/<p>/g, '')
            .replace(/<\/p>/g, '\n\n')
            .replace(/<ul>/g, '')
            .replace(/<\/ul>/g, '\n\n')
            .replace(/<li>/g, '— ')
            .replace(/<\/li>/g, '\n')
            .replace(/<br>/g, '\n')
            .replace(/<br\s*\/>/g, '\n');

        // Разбиваем на чанки по абзацам (сохраняем теги)
        const paragraphs = replyText.split('\n\n');
        const chunks = [];
        let currentChunk = '';

        for (const p of paragraphs) {
            if ((currentChunk + '\n\n' + p).length < 4000) {
                currentChunk += (currentChunk ? '\n\n' : '') + p;
            } else {
                if (currentChunk) chunks.push(currentChunk);
                // Если абзац больше 4000 (очень редко), бьем жестко
                if (p.length >= 4000) {
                    const hardChunks = p.match(/[\s\S]{1,4000}/g) || [];
                    chunks.push(...hardChunks);
                } else {
                    currentChunk = p;
                }
            }
        }
        if (currentChunk) chunks.push(currentChunk);
        
        try {
            await ctx.api.editMessageText(ctx.chat.id, loadingMsg.message_id, chunks[0], { parse_mode: 'HTML' });
            for (let i = 1; i < chunks.length; i++) {
                await ctx.reply(chunks[i], { parse_mode: 'HTML' });
            }
        } catch (e) {
            // Фолбэк, если HTML кривой
            await ctx.api.editMessageText(ctx.chat.id, loadingMsg.message_id, chunks[0]);
            for (let i = 1; i < chunks.length; i++) {
                await ctx.reply(chunks[i]);
            }
        }

        if (replyText.includes('50 отжиманий')) {
            user.strikes = (user.strikes || 0) + 1;
            if (user.strikes >= 3) {
                user.frozen = true;
                await ctx.reply("<b>ФИНИШ.</b> Ты набрал 3 страйка (нытье). Ты заморожен и лишен голоса. Переходи в оффлайн-режим.", { parse_mode: 'HTML' });
            } else {
                await ctx.reply(`<b>СТРАЙК ЗА НЫТЬЕ!</b> Упаднический настрой зафиксирован. У тебя ${user.strikes} страйка(ов) из 3. Дальше — бан.`, { parse_mode: 'HTML' });
            }
            await user.save();
        }
    }
};

const handleMyChatMember = async (ctx) => {
    try {
        const newStatus = ctx.myChatMember.new_chat_member.status;
        if (newStatus === 'kicked') {
            const telegramId = ctx.from.id;
            const user = await User.findOne({ telegramId });
            if (user) {
                await Report.deleteMany({ userId: user._id });
                await User.deleteOne({ telegramId });
                console.log(`User ${telegramId} (${user.username || 'unknown'}) blocked the bot. All data purged.`);
            }
        }
    } catch (error) {
        console.error("Error in handleMyChatMember:", error);
    }
};

export {
    handleStart,
    handleProgress,
    handleSettings,
    handleSettingsCallback,
    handleTimezoneCallback,
    handleTasks,
    handleTaskDoneCallback,
    handleRemindLaterCallback,
    handleText,
    handleMyChatMember
};
