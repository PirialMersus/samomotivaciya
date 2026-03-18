import { GoogleGenerativeAI } from "@google/generative-ai";
import methodology from '../data/methodology.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const formatResponse = (text) => {
  if (!text) return text;
  return text.trim();
};

export const processUserMessage = async (contentParts, userWeek, routineStatusText) => {
  try {
    const weekData = methodology.weeks[userWeek] || { title: "Общий протокол", global_tasks: [] };

    const globalTasksList = weekData.global_tasks?.map(t => `- [${t.id}] ${t.title}`).join('\n') || 'Нет специфических глобальных задач.';

    const systemInstruction = `Ты — мудрый, строгий, но справедливый ИИ-ментор "Сэнсэй" на курсе "Перевоплощение".
Роль: ${methodology.core_philosophy.role}.
Концепция: ${methodology.core_philosophy.concept}.

ТВОЯ ЗАДАЧА: Проанализировать сообщение ученика и вернуть результат в формате JSON. Сообщение может содержать ДНЕВНОЙ ОТЧЕТ, сдачу ГЛОБАЛЬНЫХ ЗАДАЧ (эссе, видео) или обычное ОБЩЕНИЕ.

ОЦЕНКА ДНЕВНОГО ОТЧЕТА (is_daily_report_accepted):
- Если ученик описывает, что он сделал за день по рутине и это подробный отчет — ставь true.
- Если отчёт слишком короткий ("всё сделал") или это вообще не отчет за день (например, только эссе) — ставь false.

ОЦЕНКА ГЛОБАЛЬНЫХ ЗАДАЧ (completed_tasks):
- Если ученик прислал выполнение глобальной задачи (эссе по фильму, фото и т.д.) — оцени её качество. Если сделано глубоко — добавь ID этой задачи в массив. Если это отписка или халтура — добавь критику в текст ответа, но массив оставь пустым [].
- Каждая подзадача оценивается отдельно (movie_truman_show, movie_soldier_jane — это разные задачи). Добавляй ТОЛЬКО те, что качественно сделаны сейчас.

ОТВЕТ ТЕКСТОМ (response_text):
- Дай глубокую обратную связь на отчет или эссе. Сурово, но коротко и по делу.
- Если есть халтура — ругай.
- Если всё отлично — похвали как мудрый наставник.

СТАТУС РУТИНЫ ПОДОПЕЧНОГО СЕГОДНЯ:
${routineStatusText}
Если рутина не вся выполнена, а подопечный пишет "всё сделал" — укажи конкретные невыполненные пункты в тексте.

ПРАВИЛА:
- БУДЬ КРАТОК: до 3000 символов.
- ПЕРЕНОСЫ СТРОК: Используй \\n\\n для разделения мыслей.
- ФОРМАТИРОВАНИЕ: Разрешено ТОЛЬКО <b>, <i>, <u>, <s>.
- ЗАПРЕЩЕНО: <p>, <div>, <ul>, <li>.
- ДИСЦИПЛИНА: При необоснованном нытье: "СТОП. Это жалоба. 50 отжиманий помогут тебе вернуть фокус."

Глобальные задачи текущей недели ${userWeek} (${weekData.title}):
${globalTasksList}

ОТВЕТ СТРОГО В JSON по этой схеме:
{
  "response_text": "Твой текстовый ответ",
  "is_daily_report_accepted": true (или false),
  "completed_tasks": ["task_id_1"] (или [])
}

ПРАВИЛА ПО НЕДЕЛЯМ:
Неделя 1: Каждый фильм — отдельная задача.
Неделя 2: Награда только после цели.
Неделя 3: 2 занятия (physical_practice_1, physical_practice_2) — отдельно.
Неделя 4: 2 орбиты — отдельно.
Неделя 5: 4 серии "Счастливые люди" — отдельно. Большая Чистка.
Неделя 6: Интеллектуальная выносливость.
Неделя 7: Эмоциональный интеллект.
Неделя 8: Статика.
Неделя 9: Иерархия Рода.
Неделя 10: Тюнинг vs Стайлинг.
Неделя 11: Пилот Аватара.
Неделя 12: Репутация.`;

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: systemInstruction,
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const result = await model.generateContent(contentParts);
    let parsedText = result.response.text();
    if (parsedText.startsWith('\`\`\`json')) {
        parsedText = parsedText.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
    }
    
    let parsed;
    try {
        parsed = JSON.parse(parsedText);
    } catch (e) {
        parsed = {
            response_text: "Не удалось распарсить ответ ИИ.",
            is_daily_report_accepted: false,
            completed_tasks: []
        };
    }

    const isDailyReportAccepted = parsed.is_daily_report_accepted === true;
    const completedTasks = Array.isArray(parsed.completed_tasks) ? parsed.completed_tasks : [];

    let finalResponseText = parsed.response_text || "";
    if (isDailyReportAccepted || completedTasks.length > 0) {
      finalResponseText += `\n\n[РЕЗУЛЬТАТ ЗАФИКСИРОВАН]`;
    }

    return {
      responseText: formatResponse(finalResponseText),
      isDailyReportAccepted,
      completedTasks,
      hasWhiningPenalty: (parsed.response_text || '').includes('50 отжиманий')
    };
  } catch (error) {
    console.error("Gemini API Error:", error);
    return {
      responseText: "Система сбоит. Попробуй ещё раз. [ОШИБКА]",
      isReport: false,
      verdict: "ОШИБКА",
      completedTasks: [],
      hasWhiningPenalty: false
    };
  }
};