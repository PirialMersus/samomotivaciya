const createMainMenuKeyboard = (isAdmin = false) => {
    const keyboard = [
        [{ text: "📚 Задания" }, { text: "📈 Прогресс" }],
        [{ text: "ℹ️ Помощь и Правила" }, { text: "⚙️ Настройки" }]
    ];

    if (isAdmin) {
        keyboard.push([{ text: "👥 Активные юзеры" }]);
        keyboard.push([{ text: "📅 Выставить неделю" }, { text: "🧪 Тест напоминания" }]);
    }

    return {
        keyboard,
        resize_keyboard: true
    };
};

const createHelpMenuKeyboard = () => {
    return {
        keyboard: [
            [{ text: "📜 Правила игры" }, { text: "📚 Пояснение заданий" }],
            [{ text: "✍️ Написать админу" }, { text: "🔙 Назад" }]
        ],
        resize_keyboard: true
    };
};

export { createMainMenuKeyboard, createHelpMenuKeyboard };
