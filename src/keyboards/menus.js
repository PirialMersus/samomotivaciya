const createMainMenuKeyboard = () => {
    return {
        keyboard: [
            [{ text: "📚 Задания" }, { text: "📈 Прогресс" }],
            [{ text: "🧘 Сэнсэй, помоги!" }, { text: "⚙️ Настройки" }]
        ],
        resize_keyboard: true
    };
};

const createHelpMenuKeyboard = () => {
    return {
        keyboard: [
            [{ text: "📚 Конспект лекции" }],
            [{ text: "❓ Задать вопрос" }],
            [{ text: "🔙 Назад" }]
        ],
        resize_keyboard: true
    };
};

export { createMainMenuKeyboard, createHelpMenuKeyboard };
