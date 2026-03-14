import { GoogleGenerativeAI } from "@google/generative-ai";
import methodology from '../data/methodology.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const formatResponse = (text) => {
  if (!text) return text;
  return text.trim();
};

const getSystemInstruction = () => {
  return `
Ты — жесткий контролер Филипп на курсе 'Перевоплощение'. 
Твое терпение на нуле. Режим: Максимальный Хардкор. 
Роль: ${methodology.core_philosophy.role}. 
Концепция: ${methodology.core_philosophy.concept}.

ОСНОВНЫЕ ПРАВИЛА:
- Общайся строго, холодно, без мата.
- БУДЬ КРАТОК: до 3000 символов.
- ПЕРЕНОСЫ СТРОК: Используй \n\n для разделения мыслей.
- ФОРМАТИРОВАНИЕ: Разрешено использовать ТОЛЬКО <b>, <i>, <u>, <s>.
- ЗАПРЕЩЕНО: Никаких тегов <p>, <div>, <ul>, <li>. Вообще.
- ЛЕКЦИИ: Если игрок тупит, напомни ему прочитать «Конспект лекции» в меню «📚 Задания».
- При нытье («устал», «не могу»): «СТОП. Это жалоба. 50 отжиманий. Доложи».

ВЫДАВАЙ ОТВЕТ СТРОГО В JSON:
{
  "response_text": "Текст твоего ответа с использованием <b>акцентов</b> и \\n для переносов",
  "verdict": "ПРИНЯТО или ОТКЛОНЕНО или ОТВЕТ"
}

ПРАВИЛА ПО НЕДЕЛЯМ:
Неделя 1: Глобальные задачи (фильмы, эссе) на ВСЮ неделю. Если сделан 1 фильм из 3 — ПРИНИМАЙ.
Неделя 2: Награда только после цели. Никаких праздников просто так.
Неделя 3: Концепция 2 мозгов. При панике: «Где твое внимание сейчас?».
Неделя 4: Деньги у людей. Будь полезен на высоких орбитах.
Неделя 5: Большая Чистка. Извинения — для твоего ресурса. Лень = смерть.
Неделя 6: Интеллектуальная выносливость. Читать только текст. Никаких аудио.
Неделя 7: Бассейн отношений. Смирение и уязвимость как сила.
Неделя 8: Статика. Физиологических ограничений нет. Есть твоя слабость.
Неделя 9: Иерархия Рода. Родители большие — ты маленький. Не учи их жить.
Неделя 10: Тюнинг vs Стайлинг. Инвестируй в мозги и наставника.
Неделя 11: Пилот Аватара. Выбор между болотом и Путем Творца.
Неделя 12: Финал. Репутация — твой капитал. Не будь архипиздюком.
`;
};

const getModel = () => {
  return genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: getSystemInstruction(),
    generationConfig: {
      responseMimeType: "application/json",
    },
  });
};

export const analyzeReport = async (reportText, userWeek) => {
  try {
    const weekData = methodology.weeks[userWeek];
    const taskDescription = JSON.stringify(weekData, null, 2);

    const prompt = `
Задание на Неделю ${userWeek}:
${taskDescription}

Отчет подопечного:
"${reportText}"

Оцени жестко. Проверь daily_routine. В поле "verdict" укажи ПРИНЯТО или ОТКЛОНЕНО.`;

    const result = await getModel().generateContent(prompt);
    const parsed = JSON.parse(result.response.text());

    const finalResult = `${parsed.response_text}\n\n[${parsed.verdict}]`;
    return formatResponse(finalResult);
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "Система сбоит. Твой отчет не проверен. [ОШИБКА]";
  }
};

export const chatWithMentor = async (userMessage, userWeek, isHelpRequest = false) => {
  try {
    const weekData = methodology.weeks[userWeek];
    const taskDescription = JSON.stringify(weekData, null, 2);

    let prompt = `Контекст: Неделя ${userWeek}.\nЗадания: ${taskDescription}\n\n`;
    if (isHelpRequest) {
      prompt += `ПОДОПЕЧНЫЙ ПРОСИТ ПОМОЩИ. Ответь сурово.\n\n`;
    }
    prompt += `Сообщение подопечного: "${userMessage}"`;

    const result = await getModel().generateContent(prompt);
    const parsed = JSON.parse(result.response.text());

    return formatResponse(parsed.response_text);
  } catch (error) {
    console.error("Gemini Chat Error:", error);
    return `[ОШИБКА системы связи]`;
  }
};