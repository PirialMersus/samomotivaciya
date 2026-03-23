import { InlineKeyboard } from "grammy";
import { DateTime } from "luxon";

export const createCalendarKeyboard = (year, month, todayStr) => {
    const keyboard = new InlineKeyboard();
    const dt = DateTime.local(year, month, 1);
    
    const prevMonth = dt.minus({ months: 1 });
    const nextMonth = dt.plus({ months: 1 });
    
    keyboard.text("⬅️", `calendar_nav:${prevMonth.year}_${prevMonth.month}`);
    keyboard.text(`${dt.toFormat('LLLL yyyy', { locale: 'ru' }).toUpperCase()}`, "ignore");
    keyboard.text("➡️", `calendar_nav:${nextMonth.year}_${nextMonth.month}`);
    keyboard.row();

    const weekDays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
    weekDays.forEach(day => keyboard.text(day, "ignore"));
    keyboard.row();

    let firstDayOfWeek = dt.weekday; 
    let daysInMonth = dt.daysInMonth;

    for (let i = 1; i < firstDayOfWeek; i++) {
        keyboard.text(" ", "ignore");
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const currentDt = dt.set({ day });
        const dateStr = currentDt.toFormat('yyyy-MM-dd');
        
        const isPast = dateStr < todayStr;
        const callbackData = isPast ? "ignore" : `set_date:${dateStr}`;
        const label = isPast ? "·" : day.toString();

        keyboard.text(label, callbackData);
        
        if (currentDt.weekday === 7) {
            keyboard.row();
        }
    }

    // Если последний день не воскресенье, добиваем пустые кнопки
    const lastDayOfWeek = dt.set({ day: daysInMonth }).weekday;
    if (lastDayOfWeek !== 7) {
        for (let i = lastDayOfWeek; i < 7; i++) {
            keyboard.text(" ", "ignore");
        }
        keyboard.row();
    } else {
        // Убедимся, что row() вызван, если последней кнопкой было воскресенье
        // Но `row()` уже вызывался в цикле.
    }

    // Кнопка назад
    keyboard.text("🔙 Назад", "add_task_date_back").row();

    return keyboard;
};
