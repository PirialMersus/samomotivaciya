import methodology, { getFullDailyRoutine, getFullTaboo } from '../data/methodology.js';
import { InlineKeyboard } from 'grammy';
import { DateTime } from 'luxon';
import CustomTask from '../models/CustomTask.js';

export const getTasksMessage = async (user, todayStr) => {
    const weekData = methodology.weeks[user.currentWeek];
    if (!weekData) return null;

    const customTasks = await CustomTask.find({ telegramId: user.telegramId, date: todayStr });

    let message = `<b>${weekData.title}</b>\n\n`;

    // Функция для отрисовки блока задач одной группы
    const renderBlock = (title, tasks) => {
        if (!tasks || tasks.length === 0) return "";
        let block = `<b>${title}:</b>\n`;
        tasks.forEach(t => {
            const isDone = user.progress?.get(`${t.id}_${todayStr}`);
            block += `${isDone ? '✅' : '❌'} ${t.title}\n`;
        });
        return block + "\n";
    };

    // 1. Собираем всю ежедневную рутину по неделям
    const dailyRoutineByWeek = {
        1: [...(methodology.base_daily_routine || [])],
        2: [...(methodology.week2_persistent_routine || [])],
        3: [...(methodology.week3_persistent_routine || [])],
        4: [...(methodology.week4_persistent_routine || [])]
    };

    // Добавляем специфические задачи текущей недели в соответствующий блок
    const currentSpecificRoutine = methodology.weeks[user.currentWeek]?.daily_routine || [];
    if (currentSpecificRoutine.length > 0) {
        dailyRoutineByWeek[user.currentWeek] = [
            ...(dailyRoutineByWeek[user.currentWeek] || []),
            ...currentSpecificRoutine
        ];
    }

    // Рендерим блоки рутины
    for (let w = 1; w <= user.currentWeek; w++) {
        const tasks = dailyRoutineByWeek[w];
        if (tasks && tasks.length > 0) {
            message += renderBlock(w === 1 ? "📌 Базовая рутина" : `📌 Рутина ${w}-й недели`, tasks);
        }
    }

    // 2. Глобальные задачи недели
    message += `<b>🔥 Глобальные задачи недели:</b>\n`;
    weekData.global_tasks?.forEach(t => {
        const isDone = user.completedGlobalTasks?.includes(t.id);
        const icon = t.isPersistent ? '🔄' : (isDone ? '✅' : '❌');
        message += `🚀 ${t.title} ${icon}\n`;
    });
    message += "\n";

    if (user.currentWeek === 5) {
        message += `⚠️ <b>БОЛЬШАЯ ЧИСТКА:</b>\nЗавершение ВСЕХ хвостов за недели 1-4.\n\n`;
    }

    // 3. Собираем все Табу по неделям
    const tabooByWeek = {
        1: [...(methodology.base_taboo || [])],
        2: [...(methodology.week2_persistent_taboo || [])],
        4: [...(methodology.week4_persistent_taboo || [])]
    };

    const currentSpecificTaboo = methodology.weeks[user.currentWeek]?.taboo || [];
    if (currentSpecificTaboo.length > 0) {
        tabooByWeek[user.currentWeek] = [
            ...(tabooByWeek[user.currentWeek] || []),
            ...currentSpecificTaboo
        ];
    }

    const renderTabooBlock = (title, taboos) => {
        if (!taboos || taboos.length === 0) return "";
        let block = `<b>${title}:</b>\n`;
        taboos.forEach(t => {
            const isDone = user.progress?.get(`${t.id}_${todayStr}`);
            block += `${isDone ? '✅' : '❌'} <b>${t.title}</b>: ${t.detail}\n`;
        });
        return block + "\n";
    };

    for (let w = 1; w <= user.currentWeek; w++) {
        const taboos = tabooByWeek[w];
        if (taboos && taboos.length > 0) {
            message += renderTabooBlock(w === 1 ? "🚫 Базовые Табу" : `🚫 Табу ${w}-й недели`, taboos);
        }
    }

    if (customTasks.length > 0) {
        message += `<b>📝 Мои личные задачи:</b>\n`;
        customTasks.forEach(t => {
            message += `${t.isDone ? '✅' : '❌'} ${t.title}\n`;
        });
    }

    const taskKeyboard = new InlineKeyboard();
    
    // Группируем кнопки по неделям
    for (let w = 1; w <= user.currentWeek; w++) {
        const weekTasks = [];
        
        if (w === 1) {
            // Базовые рутины и табу — это Неделя 1
            weekTasks.push(...(methodology.base_daily_routine || []), ...(methodology.base_taboo || []));
        } else {
            // Постоянные рутины и табу для конкретной недели
            const routineKey = `week${w}_persistent_routine`;
            const tabooKey = `week${w}_persistent_taboo`;
            if (methodology[routineKey]) weekTasks.push(...methodology[routineKey]);
            if (methodology[tabooKey]) weekTasks.push(...methodology[tabooKey]);
        }
        
        // Специфические задачи ЭТОЙ недели (если мы на ней сейчас)
        if (w === user.currentWeek) {
            const specificRoutine = methodology.weeks[w]?.daily_routine || [];
            const specificTaboo = methodology.weeks[w]?.taboo || [];
            weekTasks.push(...specificRoutine, ...specificTaboo);
        }

        // Оставляем только невыполненные на сегодня задачи этой недели
        const pending = weekTasks.filter(t => {
            // Если progress отсутствует или не является Map/объектом с методом get, считаем задачу невыполненной
            if (!user.progress || typeof user.progress.get !== 'function') return true;
            return !user.progress.get(`${t.id}_${todayStr}`);
        });

        if (pending.length > 0) {
            // Добавляем заголовок недели как некликабельную кнопку (ignore)
            taskKeyboard.text(`--- НЕДЕЛЯ ${w} ---`, "ignore").row();
            pending.forEach(t => {
                const btnText = t.type === 'taboo' ? `Соблюдал ✅: ${t.title}` : `Сделал ✅: ${t.title}`;
                taskKeyboard.text(btnText, `done:${t.id}`).row();
            });
        }
    }

    const dt = DateTime.now().setZone(user.timezone || 'Europe/Kyiv');
    
    taskKeyboard.text("➕ Своя задача", "add_task_step_title").row();
    taskKeyboard.text("📝 Сдать отчет за день", "submit_report_start").row();
    
    if (dt.weekday === 7) {
        taskKeyboard.text("📊 Сдать недельный отчет", "submit_weekly_report_start").row();
    }

    customTasks.filter(t => !t.isDone).forEach(t => {
        taskKeyboard.text(`✅ ${t.title}`, `custom_done:${t._id}`).row();
    });

    return {
        text: message,
        reply_markup: taskKeyboard
    };
};
