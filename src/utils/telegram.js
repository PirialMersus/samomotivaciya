export const sendLongMessage = async (ctx, text, options = {}) => {
    const totalMaxLength = 4090; // Запас для безопасности
    if (!text || text.length <= totalMaxLength) {
        return await ctx.reply(text || "Пустое сообщение.", options);
    }

    const chunks = [];
    let remainingText = text;

    while (remainingText.length > 0) {
        if (remainingText.length <= totalMaxLength) {
            chunks.push(remainingText);
            break;
        }

        let chunkEnd = totalMaxLength;
        const subtext = remainingText.substring(0, totalMaxLength);
        
        // Поиск последнего разрыва строки для красивого разбиения
        const lastNewline = subtext.lastIndexOf('\n');
        if (lastNewline > totalMaxLength * 0.7) {
            chunkEnd = lastNewline;
        } else {
            // Если нет переносов, ищем пробел
            const lastSpace = subtext.lastIndexOf(' ');
            if (lastSpace > totalMaxLength * 0.8) {
                chunkEnd = lastSpace;
            }
        }

        chunks.push(remainingText.substring(0, chunkEnd).trim());
        remainingText = remainingText.substring(chunkEnd).trim();
    }

    let lastResult;
    for (const chunk of chunks) {
        lastResult = await ctx.reply(chunk, options);
    }

    return lastResult;
};
