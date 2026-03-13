import { GoogleGenerativeAI } from "@google/generative-ai";
import methodology from '../data/methodology.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Функция очистки текста от артефактов ИИ
const formatResponse = (text) => {
  if (!text) return text;
  return text
    .replace(/\\n/g, '\n')   
    .replace(/```html/g, '') 
    .replace(/```/g, '')
    .trim();
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
- ФОРМАТ: ТОЛЬКО HTML (<b>, <i>, <s>, <u>). НИКАКОГО Markdown.
- Абзацы — через двойной перенос строки (\\n\\n).
- При нытье («устал», «не могу»): «СТОП. Это жалоба. 50 отжиманий. Доложи».

ПРАВИЛА ПО НЕДЕЛЯМ:
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

Вердикт по отчетам: саркастично, в конце [ПРИНЯТО] или [ОТКЛОНЕНО].
`;
};

const getModel = () => {
  return genAI.getGenerativeModel({
    model: "gemini-2.5-flash", 
    systemInstruction: getSystemInstruction()
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

Оцени жестко. Проверь daily_routine и задачи. В конце: [ПРИНЯТО] или [ОТКЛОНЕНО].`;

    const result = await getModel().generateContent(prompt);
    return formatResponse(result.response.text());
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
      prompt += `ПОДОПЕЧНЫЙ ПРОСИТ ПОМОЩИ. Ответь сурово и по базе лекций.\n\n`;
    }
    
    prompt += `Сообщение подопечного: "${userMessage}"`;
    
    const result = await getModel().generateContent(prompt);
    return formatResponse(result.response.text());
  } catch (error) {
    console.error("Gemini Chat Error:", error);
    return `[ОШИБКА системы связи]`;
  }
};