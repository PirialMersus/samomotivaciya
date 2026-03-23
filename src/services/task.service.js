import methodology, { getFullDailyRoutine, getFullTaboo } from '../data/methodology.js';
import { InlineKeyboard } from 'grammy';
import CustomTask from '../models/CustomTask.js';

export const getTasksMessage = async (user, todayStr) => {
    const weekData = methodology.weeks[user.currentWeek];
    if (!weekData) return null;

    const customTasks = await CustomTask.find({ telegramId: user.telegramId, date: todayStr });

    let message = `<b>${weekData.title}</b>\n\n`;
    const allRoutine = getFullDailyRoutine(user.currentWeek);
    if (allRoutine.length > 0) {
        message += `<b>Ежедневная рутина:</b>\n`;
        allRoutine.forEach(t => {
            const isDone = user.progress?.get(`${t.id}_${todayStr}`);
            message += `${isDone ? '✅' : '❌'} ${t.title}\n`;
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

    const allTaboo = getFullTaboo(user.currentWeek);
    if (allTaboo.length > 0) {
        message += `\n<b>Табу (соблюдал весь день):</b>\n`;
        allTaboo.forEach(t => {
            const isDone = user.progress?.get(`${t.id}_${todayStr}`);
            message += `${isDone ? '✅' : '❌'} <b>${t.title}</b>: ${t.detail}\n`;
        });
    }

    if (customTasks.length > 0) {
        message += `\n\n\n<b>Мои задачи:</b>\n`;
        customTasks.forEach(t => {
            message += `${t.isDone ? '✅' : '❌'} ${t.title}\n`;
        });
    }

    const taskKeyboard = new InlineKeyboard();
    let hasButtons = false;

    [...getFullDailyRoutine(user.currentWeek), ...getFullTaboo(user.currentWeek)].forEach(t => {
        const isDone = user.progress?.get(`${t.id}_${todayStr}`);
        if (!isDone) {
            const btnText = t.type === 'taboo' ? `Соблюдал ✅: ${t.title}` : `Сделал ✅: ${t.title}`;
            taskKeyboard.text(btnText, `done:${t.id}`).row();
            hasButtons = true;
        }
    });

    taskKeyboard.text("➕ Добавить свою задачу", "add_task_step_title").row();

    customTasks.filter(t => !t.isDone).forEach(t => {
        taskKeyboard.text(`✅ ${t.title}`, `custom_done:${t._id}`).row();
        hasButtons = true;
    });

    return {
        text: message,
        reply_markup: taskKeyboard
    };
};
