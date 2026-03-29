import { getTone } from '../utils/tone.js';
import { getTasksMessage } from './task.service.js';
import { DateTime } from 'luxon';
import fs from 'fs';
import path from 'path';
import { InputFile } from 'grammy';

export const sendWeekWelcome = async (bot, user, options = {}) => {
    const { includeTasks = false } = options;
    const tone = getTone(user.currentWeek);
    const imagePath = `src/assets/images/week_${user.currentWeek}.png`;
    const fullPath = path.resolve(imagePath);
    
    let captionText;
    if (user.currentWeek === 1) {
        captionText = `<b>ПОЗДРАВЛЯЮ С ПЕРВОЙ НЕДЕЛЕЙ ТВОЕЙ НОВОЙ ЖИЗНИ!</b> 🌟\n\nТвой путь начинается здесь. Твое звание: <b>${tone.label}</b>. Твоя задача — дисциплина и чистота.`;
    } else {
        captionText = `<b>ПОЗДРАВЛЯЮ С ПЕРЕХОДОМ!</b>\n\nТы перешел на <b>Неделю ${user.currentWeek}</b>. Твое новое звание: <b>${tone.label}</b>. 🏆\n\nВсе твои прошлые заслуги и страйки обнулены, впереди новые испытания.`;
    }

    const sendOptions = { 
        caption: captionText, 
        parse_mode: 'HTML' 
    };

    if (fs.existsSync(fullPath)) {
        await bot.api.sendPhoto(user.telegramId, new InputFile(fullPath), sendOptions);
    } else {
        await bot.api.sendMessage(user.telegramId, captionText, { parse_mode: 'HTML' });
    }

    if (includeTasks) {
        const dt = DateTime.now().setZone(user.timezone || 'Europe/Kyiv');
        const todayStr = dt.toFormat('yyyy-MM-dd');
        const tasksData = await getTasksMessage(user, todayStr);
        if (tasksData) {
            await bot.api.sendMessage(user.telegramId, tasksData.text, {
                parse_mode: 'HTML',
                reply_markup: tasksData.reply_markup
            });
        }
    }
};
