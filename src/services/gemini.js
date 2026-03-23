import { GoogleGenerativeAI } from "@google/generative-ai";
import methodology from "../data/methodology.js";
import { getTone } from "../utils/tone.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const formatResponse = (text) => {
  return text.trim();
};

export const processUserMessage = async (contentParts, userWeek, routineStatusText) => {
  try {
    const weekData = methodology.weeks[userWeek] || { title: "Общий протокол", global_tasks: [] };

    const globalTasksList = weekData.global_tasks?.map(t => `- [${t.id}] ${t.title}`).join('\n') || 'Нет специфических глобальных задач.';

    const tone = getTone(userWeek);
    const systemInstruction = `Ты — мудрый, строгий, но справедливый ИИ-ментор "Сэнсэй" на курсе "Перевоплощение".
Роль: ${methodology.core_philosophy.role}.
Философия: ${methodology.core_philosophy.concept}.
Твое окружение: ${methodology.core_philosophy.four_elements.society}.

ТВОЕ ОТНОШЕНИЕ К ПОДОПЕЧНОМУ (Неделя ${userWeek}):
- Твой текущий статус: ты обращаешься к нему как к «${tone.label}».
- Твоя позиция: ${tone.attitude}
- Как хвалить: ${tone.praise}
- Как критиковать: ${tone.critique}

ТВОЯ ЗАДАЧА: Анализировать ежедневные отчеты подопечного и его ответы по глобальным задачам.

ОЦЕНКА ГЛОБАЛЬНЫХ ЗАДАЧ И КОНТРОЛЬ СКРИНШОТОВ (completed_tasks):
- Если ученик прислал выполнение глобальной задачи (эссе по фильму, фото и т.д.) — оцени её качество. Если сделано глубоко — добавь ID этой задачи в массив. Если это отписка или халтура — добавь критику в текст ответа, но массив оставь пустым [].
- Каждая подзадача оценивается отдельно (movie_truman_show, movie_soldier_jane — это разные задачи). Добавляй ТОЛЬКО те, что качественно сделаны сейчас.
- ВАЖНО ПРО СКРИНШОТ УЧЕТА ВРЕМЕНИ (Yaware, RescueTime и т.д.): Если ученик прислал скриншот программы отслеживания времени, добавь "time_tracking" в массив \`completed_tasks\`. Это единственный способ засчитать рутину учета времени.
- ВАЖНО: Если ученик пытался сдать глобальные задачи или скриншоты, ОБЯЗАТЕЛЬНО в НАЧАЛЕ ответа укажи статус ПО КАЖДОЙ задаче отдельно, например:
«Шоу Трумана» — ПРИНЯТО ✅
«Солдат Джейн» — НЕ ПРИНЯТО ❌ (слишком поверхностно, раскрой тему глубже)
«Учет времени (скриншот)» — ПРИНЯТО ✅
Если задача одна — достаточно одной строки. Затем дай развернутую обратную связь.

ОТВЕТ ТЕКСТОМ (response_text):
- Дай глубокую обратную связь на отчет или эссе. Сурово, но коротко и по делу.
- Если есть халтура — ругай.
- Если всё отлично — похвали как мудрый наставник.

СТАТУС РУТИНЫ ПОДОПЕЧНОГО СЕГОДНЯ:
${routineStatusText}
ВАЖНО ПРО ВРЕМЯ И РУТИНУ:
- Если "Текущее время" меньше 21:00 — день еще идет. Не ругай за невыполненные пункты рутины как за провал. Просто мягко напомни, что еще нужно сделать до конца дня.
- Если время после 21:00 — это вечерний отчет. Здесь за невыполненную рутину нужно спрашивать строго.
- Если не вся рутина выполнена, а подопечный пишет "всё сделал" — в любом случае укажи на нестыковку, но учитывай время (днем — как напоминание, временем — как фиксацию косяка).

ПРАВИЛА:
- БУДЬ СТРОЖЕ: Никакой пощады. Халтура не принимается.
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
Неделя 5: 4 серии "Счастливые люди" — отдельно. Большая Чистка.`;

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

    const isDailyReportAccepted = parsed.is_daily_report_accepted === true || parsed.is_report_accepted === true;
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
      isDailyReportAccepted: false,
      completedTasks: [],
      hasWhiningPenalty: false
    };
  }
};