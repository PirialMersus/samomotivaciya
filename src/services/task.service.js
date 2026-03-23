import methodology, { getFullDailyRoutine, getFullTaboo } from '../data/methodology.js';
import { InlineKeyboard } from 'grammy';
import CustomTask from '../models/CustomTask.js';

export const getTasksMessage = async (user, todayStr) => {
    const weekData = methodology.weeks[user.currentWeek];
    if (!weekData) return null;

    const customTasks = await CustomTask.find({ telegramId: user.telegramId, date: todayStr });

    let message = `<b>${weekData.title}</b>\n\n`;
    const pendingRoutine = getFullDailyRoutine(user.currentWeek).filter(t => !user.progress?.get(`${t.id}_${todayStr}`));
    
    if (pendingRoutine.length > 0) {
        message += `<b>Ежедневная рутина:</b>\n`;
        pendingRoutine.forEach(t => {
            message += `❌ ${t.title}\n`;
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

    const fullTaboo = getFullTaboo(user.currentWeek).filter(t => !user.progress?.get(`${t.id}_${todayStr}`));
    if (fullTaboo.length > 0) {
        message += `\n<b>Табу (соблюдал весь день):</b>\n`;
        fullTaboo.forEach(t => {
            message += `❌ <b>${t.title}</b>: ${t.detail}\n`;
        });
    }

    const pendingCustom = customTasks.filter(t => !t.isDone);
    if (pendingCustom.length > 0) {
        message += `\n\n\n<b>Мои задачи:</b>\n`;
        pendingCustom.forEach(t => {
            message += `❌ ${t.title}\n`;
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

    pendingCustom.forEach(t => {
        taskKeyboard.text(`✅ ${t.title}`, `custom_done:${t._id}`).row();
        hasButtons = true;
    });

    return {
        text: message,
        reply_markup: taskKeyboard
    };
};
