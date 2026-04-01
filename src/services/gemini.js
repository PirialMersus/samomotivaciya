import { GoogleGenerativeAI } from "@google/generative-ai";
import methodology from "../data/methodology.js";
import { getTone } from "../utils/tone.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const formatResponse = (text) => {
  return text.trim();
};

export const processUserMessage = async (contentParts, userWeek, routineStatusText, existingArtifacts = {}) => {
  try {
    const weekData = methodology.weeks[userWeek] || { title: "Общий протокол", global_tasks: [] };
    const globalTasksList = weekData.global_tasks?.map(t => `- [${t.id}] ${t.title}`).join('\n') || 'Нет специфических глобальных задач.';
    const tone = getTone(userWeek);

    let artifactsContext = "\n--- ТВОИ ЗАПИСИ В БАЗЕ (АРХИВ) ---\n";
    if (existingArtifacts.desires100?.length > 0) artifactsContext += `\nХОТЕЛКИ (${existingArtifacts.desires100.length}):\n` + existingArtifacts.desires100.map((d, i) => `${i + 1}. ${d}`).join('\n') + "\n";
    if (existingArtifacts.smartGoals10?.length > 0) artifactsContext += `\nSMART-ЦЕЛИ:\n` + existingArtifacts.smartGoals10.map((g, i) => `${i + 1}. ${g}`).join('\n') + "\n";
    if (existingArtifacts.contractText) artifactsContext += `\nКОНТРАКТ:\n"${existingArtifacts.contractText}"\n`;
    if (existingArtifacts.strategicGoals) artifactsContext += `\nСТРАТЕГИЯ 2029:\n${existingArtifacts.strategicGoals}\n`;
    if (existingArtifacts.tacticalGoals) artifactsContext += `\nТАКТИКА 2026:\n${existingArtifacts.tacticalGoals}\n`;
    if (existingArtifacts.analysisOfCurrentSituation) artifactsContext += `\nАНАЛИЗ СИТУАЦИИ (ТОЧКА А):\n${existingArtifacts.analysisOfCurrentSituation}\n`;
    if (existingArtifacts.weeklyReports?.length > 0) artifactsContext += `\nПРОШЛЫЕ НЕДЕЛЬНЫЕ ОТЧЕТЫ:\n` + existingArtifacts.weeklyReports.map((r, i) => `Неделя ${r.week}: ${r.value}`).join('\n\n') + "\n";
    if (artifactsContext === "\n--- ТВОИ ЗАПИСИ В БАЗЕ (АРХИВ) ---\n") artifactsContext = "";
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

ИЗВЛЕЧЕНИЕ АРТЕФАКТОВ (extracted_artifacts):
Если подопечный прислал текст или фото с "100 хотелками", "SMART-целями", "Контрактом", "Целями до 2029/2026", "Анализом ситуации" или "Недельным отчетом":
1. "desires": Массив строк. ИЗВЛЕКАЙ ВСЕ ПУНКТЫ БЕЗ ИСКЛЮЧЕНИЯ (даже если их 114 или больше). НЕ ОБРЕЗАЙ СПИСОК.
2. "smart_goals": Массив строк.
3. "strategic_goals": Строка (цели на 3-5 лет).
4. "tactical_goals": Строка (цели до конца 2026).
5. "contract_text": Полный текст контракта.
6. "analysis_of_situation": Текст анализа жизненной ситуации (точки А).
7. "weekly_report": Текст недельного отчета (события, самочувствие, планы).

ОЦЕНКА ГЛОБАЛЬНЫХ ЗАДАЧ И КОНТРОЛЬ СКРИНШОТОВ (completed_tasks):
- Если ученик прислал выполнение глобальной задачи (эссе по фильму, фото и т.д.) — оцени её качество. Если сделано глубоко — добавь ID этой задачи в массив. Если это отписка или халтура — добавь критику в текст ответа, но массив оставь пустым [].
- Каждая подзадача оценивается отдельно. Добавляй ТОЛЬКО те, что качественно сделаны сейчас.
- ВАЖНО ПРО СКРИНШОТ УЧЕТА ВРЕМЕНИ (Yaware, RescueTime и т.д.): Если ученик прислал скриншот программы отслеживания времени, добавь "time_tracking" в массив \`completed_tasks\`. Это единственный способ засчитать рутину учета времени.
- ВАЖНО: Если ученик пытался сдать глобальные задачи или скриншоты, ОБЯЗАТЕЛЬНО в НАЧАЛЕ ответа укажи статус ПО КАЖДОЙ задаче отдельно. Дай развернутую обратную связь.

ОТВЕТ ТЕКСТОМ (response_text):
- Дай глубокую обратную связь на отчет или эссе. Сурово, но коротко и по делу.
- Если есть халтура — ругай.
- Если всё отлично — похвали как мудрый наставник.

СТАТУС РУТИНЫ ПОДОПЕЧНОГО СЕГОДНЯ:
${routineStatusText}
${artifactsContext}
ВАЖНО ПРО ВРЕМЯ И РУТИНУ:
- Если "Текущее время" меньше 21:00 — день еще идет. Не ругай за невыполненные пункты рутины как за провал. Просто мягко напомни, что еще нужно сделать до конца дня.
- Если время после 21:00 — это вечерний отчет. Здесь за невыполненную рутину нужно спрашивать строго.
- Если не вся рутина выполнена, а подопечный пишет "всё сделал" — в любом случае укажи на нестыковку, но учитывай время (днем — как напоминание, временем — как фиксацию косяка).

ПОСТ-ОТЧЁТНЫЕ ЗАДАЧИ:
Задачи «Шавасана (перед сном)» и «Ежедневный отчет» выполняются ПОСЛЕ сдачи отчёта. Они физически не могут быть отмечены до сдачи отчёта. НЕ РУГАЙ за то, что они не отмечены — просто мягко напомни: «Не забудь сделать Шавасану перед сном». Не считай их невыполненными при анализе рутины.

ОСВОБОЖДЕНИЯ ОТ ЗАДАЧ (exemptions):
1. ОБЪЕКТИВНЫЕ ПРИЧИНЫ: травма, болезнь, форс-мажор. Давай освобождение с адекватной альтернативой (ходьба вместо бега и т.д.).
2. ЧЕСТНОЕ ПРИЗНАНИЕ (Искупление): Если подопечный честно признается, что НЕ ВЫПОЛНИЛ задачу по своей вине (лень, забыл, прокрастинация), но проявляет искреннее раскаяние — ты МОЖЕШЬ дать освобождение от страйка за эту задачу, но ОБЯЗАТЕЛЬНО назначь суровое искупление (penance) в поле alternative (например: "100 отжиманий", "холодный душ", "дополнительный час учебы").
НЕ ДАВАЙ освобождение просто так. Либо объективная причина + альтернатива, либо честное раскаяние + суровое искупление. Если юзер врет или оправдывается — никаких освобождений.

ПРАВИЛА:
- БУДЬ СТРОЖЕ: Никакой пощады. Халтура не принимается.
- БУДЬ КРАТОК: до 3000 символов.
- ПЕРЕНОСЫ СТРОК: Используй \\n\\n для разделения мыслей.
- ФОРМАТИРОВАНИЕ: Разрешено ТОЛЬКО <b>, <i>, <u>, <s>.
- ЗАПРЕЩЕНО: <p>, <div>, <ul>, <li>.
- ДИСЦИПЛИНА: При необоснованном нытье: "СТОП. Это жалоба. 50 отжиманий помогут тебе вернуть фокус."
- ЕСЛИ ЮЗЕР ПРОСТО ПРОСИТ НАПОМНИТЬ АРТЕФАКТ (без сдачи отчета): верни пустую строку "" в "response_text", так как бот сам пришлет файл.

Глобальные задачи текущей недели ${userWeek} (${weekData.title}):
${globalTasksList}

ОТВЕТ СТРОГО В JSON:
{
  "response_text": "Твой текстовый ответ",
  "is_daily_report_accepted": true/false (ВАЖНО: Устанавливай в true ТОЛЬКО если пользователь ОСОЗНАННО СДАЕТ ИТОГОВЫЙ ЕЖЕДНЕВНЫЙ ОТЧЕТ ЗА ДЕНЬ. Если он просто скинул выполненную глобальную задачу, скриншот, эссе или задал вопрос без общих итогов дня — СТРОГО УСТАНАВЛИВАЙ false),
  "completed_tasks": ["task_id"],
  "exemptions": [{"task_id": "id_задачи", "reason": "причина", "alternative": "альтернатива"}],
  "requested_action": "send_contract" | "send_desires" | "send_smart_goals" | "send_strategy" | "send_tactics" | "send_analysis" | "send_weekly_reports" | null,
  "is_contract_photo": true/false,
  "extracted_artifacts": {
    "desires": [],
    "smart_goals": [],
    "strategic_goals": "",
    "tactical_goals": "",
    "contract_text": "",
    "analysis_of_situation": "",
    "weekly_report": ""
  }
}

ПРАВИЛА ПО НЕДЕЛЯМ:
Неделя 1: Каждый фильм — отдельная задача.
Неделя 5: 4 серии "Счастливые люди" — отдельно. Большая Чистка.`;

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: systemInstruction,
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 16384,
      },
    });

    const result = await model.generateContent(contentParts);
    let parsedText = result.response.text();
    if (parsedText.startsWith('```json')) {
      parsedText = parsedText.replace(/```json/g, '').replace(/```/g, '').trim();
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
    const artifacts = parsed.extracted_artifacts || {};
    const exemptions = Array.isArray(parsed.exemptions) ? parsed.exemptions : [];

    let finalResponseText = parsed.response_text || "";
    if (isDailyReportAccepted || completedTasks.length > 0) {
      finalResponseText += `\n\n[РЕЗУЛЬТАТ ЗАФИКСИРОВАН]`;
    }

    return {
      responseText: formatResponse(finalResponseText),
      isDailyReportAccepted,
      completedTasks,
      hasWhiningPenalty: (parsed.response_text || '').includes('50 отжиманий'),
      isContractPhoto: parsed.is_contract_photo || false,
      extractedArtifacts: artifacts,
      requestedAction: parsed.requested_action || null,
      exemptions
    };
  } catch (error) {
    console.error("Gemini API Error:", error);
    return {
      responseText: "Связь с Сэнсэем прервана. Попробуй ещё раз. [ОШИБКА]",
      isDailyReportAccepted: false,
      completedTasks: [],
      hasWhiningPenalty: false,
      exemptions: []
    };
  }
};

export const generateFocusReminder = async (focusArea, userWeek, tone) => {
  try {
    const systemInstruction = `Ты — мудрый Сэнсэй. Подопечный поставил себе цель или выбрал сферу интересов: "${focusArea}". Он на ${userWeek} неделе (статус: ${tone.label}). 
    Сгенерируй одну короткую, глубокую и вдохновляющую фразу или вопрос, которые помогут ему держать фокус на этой задаче. 
    Тон: ${tone.attitude}.
    Максимум 2 предложения. Используй только разрешенные теги: <b>, <i>.`;

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: systemInstruction,
    });

    const result = await model.generateContent("Сгенерируй напоминание.");
    return formatResponse(result.response.text());
  } catch (error) {
    console.error("Gemini Focus Hint Error:", error);
    return "Соберись. Твоя цель ждет действий, а не оправданий.";
  }
};