import cron from 'node-cron';
import User from '../models/User.js';
import Report from '../models/Report.js';
import CustomTask from '../models/CustomTask.js';
import methodology, { getFullDailyRoutine, getFullTaboo } from '../data/methodology.js';
import { InlineKeyboard } from 'grammy';
import { DateTime } from 'luxon';
import { getTasksMessage } from './task.service.js';
import { getTone } from '../utils/tone.js';
import * as geminiService from './gemini.js';

const isTaskExemptedForUser = (taskId, user) => {
    if (!user.exemptedTasks || user.exemptedTasks.length === 0) return false;
    return user.exemptedTasks.some(exemption => exemption.taskId === taskId);
};

const getCheckableTasksForCron = (weekNumber, user) => {
    const allDailyTasks = [...getFullDailyRoutine(weekNumber), ...(methodology.weeks[weekNumber] ? getFullTaboo(weekNumber) : [])];
    return allDailyTasks.filter(task => !task.postReport && !isTaskExemptedForUser(task.id, user));
};

const setupCronJobs = (bot) => {
    cron.schedule('*/5 * * * *', async () => {
        try {
            const users = await User.find({ frozen: false });
            for (const user of users) {
                try {
                    const tz = user.timezone || 'Europe/Kyiv';
                    const dt = DateTime.now().setZone(tz);
                    const todayStr = dt.toFormat('yyyy-MM-dd');

                    if (dt.hour === 7 && dt.minute === 0) {
                        const tasksData = await getTasksMessage(user, todayStr);
                        if (!tasksData) continue;

                        const tone = getTone(user.currentWeek);
                        let morningHeader = `<b>${tone.greeting}</b>\n`;

                        morningHeader += `07:00 на твоих часах.\n\n`;

                        if (user.currentDay === 1) {
                            const imagePath = `src/assets/images/week_${user.currentWeek}.png`;
                            
                            let captionText;
                            if (user.currentWeek === 1) {
                                captionText = `<b>ПОЗДРАВЛЯЮ С ПЕРВОЙ НЕДЕЛЕЙ ТВОЕЙ НОВОЙ ЖИЗНИ!</b> 🌟\n\nТвой путь начинается здесь. Твое звание: <b>${tone.label}</b>. Твоя задача — дисциплина и чистота.`;
                            } else {
                                captionText = `<b>ПОЗДРАВЛЯЮ С ПЕРЕХОДОМ!</b>\n\nТы перешел на <b>Неделю ${user.currentWeek}</b>. Твое новое звание: <b>${tone.label}</b>. 🏆\n\nВсе твои прошлые заслуги и страйки обнулены, впереди новые испытания.`;
                            }
                            
                            const fs = await import('fs');
                            if (fs.existsSync(imagePath)) {
                                const grammyPkg = await import('grammy');
                                await bot.api.sendPhoto(user.telegramId, new grammyPkg.InputFile(imagePath), { caption: captionText, parse_mode: 'HTML' });
                            } else {
                                await bot.api.sendMessage(user.telegramId, captionText, { parse_mode: 'HTML' });
                            }
                        }

                        if (user.currentWeek === 2) {
                            morningHeader += `Встал. Выпил 500мл воды. Бросил лед в тазик. Начинай бег натощак. Доложи о готовности.\n\n`;
                        } else if (user.currentWeek === 4) {
                            morningHeader += `8 километров сами себя не пройдут. Вставай и насыщай мозг кислородом. Отдавай, чтобы получать.\n\n`;
                        } else {
                            morningHeader += `Ниже твоя рутина на сегодня. Жми кнопки по мере выполнения.\n\n`;
                        }

                        await bot.api.sendMessage(user.telegramId, morningHeader + tasksData.text, {
                            parse_mode: 'HTML',
                            reply_markup: tasksData.reply_markup
                        });
                    }

                    if (user.currentWeek === 5 && dt.hour === 7 && dt.minute === 10) {
                        await bot.api.sendMessage(user.telegramId, "<b>Мантра прочитана?</b> Ты собрал себя или опять вышел в мир как разобранный механизм? Иди и делай центр.", { parse_mode: 'HTML' });
                    }

                    if (user.currentWeek === 9 && dt.hour === 7 && dt.minute === 5) {
                        await bot.api.sendMessage(user.telegramId, "<b>МАНТРА:</b> Твоя Мантра под подушкой? Прочитай её. Собери себя в охуенного человека прямо сейчас.", { parse_mode: 'HTML' });
                    }

                    if (user.currentWeek === 10 && dt.hour === 8 && dt.minute === 0) {
                        await bot.api.sendMessage(user.telegramId, "<b>ПЛАН НА ГОД:</b> План перед глазами? Что ты сделаешь сегодня, чтобы закрыть результат этой недели? Время идет.", { parse_mode: 'HTML' });
                    }

                    if (dt.hour === 10 && dt.minute === 0 && user.currentDay === 7) {
                        await bot.api.sendMessage(user.telegramId, "⚡️ <b>ВНИМАНИЕ: ПОСЛЕДНИЙ ДЕНЬ НЕДЕЛИ!</b>\n\nСегодня седьмой день твоей текущей недели. Убедись, что ВСЕ глобальные задачи закрыты. Если к полуночи они не будут приняты — ты получишь страйк.", { parse_mode: 'HTML' });
                    }

                    if (dt.hour >= 9 && dt.hour <= 18) {
                        if (Math.random() < 0.0075) {
                            const tone = getTone(user.currentWeek);
                            const reminder = await geminiService.generateFocusReminder(user.focusArea, user.currentWeek, tone);
                            const header = user.focusArea ? "🔔 <b>Напоминание фокуса:</b>" : "🔔 <b>Сэнсэй на связи:</b>";
                            await bot.api.sendMessage(user.telegramId, `${header}\n\n${reminder}`, { parse_mode: 'HTML' });
                        }
                    }

                    if (user.currentWeek === 3 && dt.hour === 22 && dt.minute === 0) {
                        await bot.api.sendMessage(user.telegramId, "<b>Сэнсэй советует.</b> Готовься к отбою. Помни: расслабление без внимания — это просто сон, а нам нужна осознанная разгрузка. Делай Шавасану правильно.", { parse_mode: 'HTML' });
                    }

                    if (user.currentWeek === 4 && dt.hour === 21 && dt.minute === 0) {
                        await bot.api.sendMessage(user.telegramId, "<b>Доклад:</b> Кому ты сегодня был полезен? Какие новые орбиты прощупал? Если никому — день прожит зря. Исправляйся завтра.", { parse_mode: 'HTML' });
                    }

                    if (user.currentWeek === 5 && dt.hour === 23 && dt.minute === 0) {
                        await bot.api.sendMessage(user.telegramId, "<b>ВРЕМЯ ЧУДЕС.</b> Минута пошла. Назови 3 чуда за сегодня. Не успел за 60 секунд — завтра будь внимательнее. Фильтруй реальность.", { parse_mode: 'HTML' });
                    }

                    if (user.currentWeek === 6 && dt.hour === 15 && dt.minute === 0) {
                        await bot.api.sendMessage(user.telegramId, "<b>ОТЧЕТ КОНТРОЛЕРУ:</b> Ты сегодня пользовался навигатором или заставил мозг работать? Где твои 3D-карты?", { parse_mode: 'HTML' });
                    }

                    if (user.currentWeek === 6 && dt.hour === 22 && dt.minute === 0) {
                        await bot.api.sendMessage(user.telegramId, "<b>ИНТЕЛЛЕКТУАЛЬНАЯ ВЫНОСЛИВОСТЬ:</b> Книга открыта? Конспект пишется? Или опять смотришь клипы с 15-секундной нарезкой? Включи мозг.", { parse_mode: 'HTML' });
                    }

                    if (user.currentWeek === 7 && dt.weekday === 7 && dt.hour === 12 && dt.minute === 0) {
                        await bot.api.sendMessage(user.telegramId, "<b>ДЕДЛАЙН БЛИЗКО.</b> Сегодня дедлайн генеральной чистки. Все отчеты за 6 недель должны быть в одном файле к полуночи. Если не успеешь — ты вне протокола.", { parse_mode: 'HTML' });
                    }

                    if (user.currentWeek === 8 && dt.hour === 8 && dt.minute === 0) {
                        await bot.api.sendMessage(user.telegramId, "<b>ТАЙМ-МЕНЕДЖМЕНТ:</b> Листок тайм-менеджмента готов? Каждые 10 минут ты должен знать, зачем ты живешь. Записывай.", { parse_mode: 'HTML' });
                    }

                    if (user.currentWeek === 8 && dt.hour === 14 && dt.minute === 0) {
                        await bot.api.sendMessage(user.telegramId, "<b>МАСТЕРСТВО:</b> Ты сегодня видел Мастерство? Чему научился у других или опять считаешь себя самым умным?", { parse_mode: 'HTML' });
                    }

                    if (user.currentWeek === 8 && dt.hour === 23 && dt.minute === 30) {
                        await bot.api.sendMessage(user.telegramId, "<b>СТАТИКА ДУХА:</b> Где видео твоей статики? Таймер в кадре был? Если нет — не зачет. Грузи отчет немедленно.", { parse_mode: 'HTML' });
                    }

                    if (user.currentWeek === 9 && dt.hour === 23 && dt.minute === 15) {
                        await bot.api.sendMessage(user.telegramId, "<b>ТРИ ЧУДА ДНЯ:</b> Минута пошла. Вспомни 3 чуда. Время — это всё, что у тебя есть.", { parse_mode: 'HTML' });
                    }

                    if (user.currentWeek === 10 && dt.hour === 23 && dt.minute === 30) {
                        await bot.api.sendMessage(user.telegramId, "<b>ИТОГИ ДНЯ:</b> Отчет. Сколько книг в прогрессе? Сколько наставников найдено? Помни про дедлайн.", { parse_mode: 'HTML' });
                    }

                    if (user.currentWeek === 12 && dt.hour === 23 && dt.minute === 30) {
                        await bot.api.sendMessage(user.telegramId, "<b>ХРАНИТЕЛЬ ПУТИ:</b> Где твоё Мастерство сегодня? Кому ты был полезен? Финальная неделя — покажи результат.", { parse_mode: 'HTML' });
                    }

                    if (user.currentWeek === 12 && dt.weekday === 7 && dt.hour === 20 && dt.minute === 0) {
                        await bot.api.sendMessage(user.telegramId, "<b>ДЕДЛАЙН:</b> Время вышло. Либо ты в списке победителей, либо остаешься в прошлом. Жду финальный видео-отзыв и генеральный отчет за 3 месяца.", { parse_mode: 'HTML' });
                    }

                    if (dt.hour === 23 && dt.minute === 30) {
                        const weekData = methodology.weeks[user.currentWeek];
                        if (!weekData) continue;

                        const weekJustStartedToday = user.weekStartedDate === todayStr;
                        if (weekJustStartedToday) continue;

                        const checkableTasks = getCheckableTasksForCron(user.currentWeek, user);
                        const undoneTaskNames = [];
                        for (const task of checkableTasks) {
                            const isDone = user.progress?.get(`${task.id}_${todayStr}`);
                            if (!isDone) undoneTaskNames.push(task.title);
                        }

                        const postReportTasks = [...getFullDailyRoutine(user.currentWeek), ...(methodology.weeks[user.currentWeek] ? getFullTaboo(user.currentWeek) : [])].filter(t => t.postReport);
                        const undonePostReportNames = [];
                        for (const task of postReportTasks) {
                            const isDone = user.progress?.get(`${task.id}_${todayStr}`);
                            if (!isDone) undonePostReportNames.push(task.title);
                        }

                        const hasReportToday = user.lastReportDate === todayStr;

                        if (undoneTaskNames.length > 0 || !hasReportToday) {
                            const tone = getTone(user.currentWeek);
                            let message = `<b>⚠️ ВНИМАНИЕ!</b> 23:30. `;

                            if (undoneTaskNames.length > 0) {
                                message += `У тебя НЕ закрыты: <b>${undoneTaskNames.join(', ')}</b>. Закрой их до полуночи, или получишь страйк. Если объективно не можешь — объясни причину в отчёте.\n\n`;
                            }

                            if (!hasReportToday) {
                                message += `<b>Дневной отчёт не сдан!</b> Без отчёта — автоматический страйк в полночь.\n\n`;
                            }

                            message += tone.warning;

                            if (undonePostReportNames.length > 0) {
                                message += `\n\n💡 <i>Напоминание: не забудь после отчёта сделать ${undonePostReportNames.join(' и ')}.</i>`;
                            }

                            await bot.api.sendMessage(user.telegramId, message, { parse_mode: 'HTML' });
                        }
                    }

                    if (dt.hour === 0 && dt.minute === 0) {
                        const dtYesterday = dt.minus({ days: 1 });
                        const yesterdayStr = dtYesterday.toFormat('yyyy-MM-dd');
                        const weekData = methodology.weeks[user.currentWeek];

                        user.currentDay = (user.currentDay || 1) + 1;

                        if (!weekData) {
                            await user.save();
                            continue;
                        }

                        const checkableTasks = getCheckableTasksForCron(user.currentWeek, user);
                        let hasUndoneRoutine = false;
                        for (const task of checkableTasks) {
                            const isDone = user.progress?.get(`${task.id}_${yesterdayStr}`);
                            if (!isDone) hasUndoneRoutine = true;
                        }

                        const hadReportYesterday = user.lastReportDate === yesterdayStr;

                        if (!hasUndoneRoutine && hadReportYesterday) {
                            user.totalRoutineDays = (user.totalRoutineDays || 0) + 1;
                        }

                        if (user.isReadyForNextWeek && user.totalRoutineDays >= 1) {
                            user.currentWeek += 1;
                            user.currentDay = 1;
                            user.completedGlobalTasks = [];
                            user.totalRoutineDays = 0;
                            user.isReadyForNextWeek = false;
                            user.weekStartedDate = dt.toFormat('yyyy-MM-dd');
                            user.strikes = 0;
                            user.exemptedTasks = [];
                            await user.save();
                        } else {
                            let reasonParts = [];
                            if (hasUndoneRoutine) reasonParts.push("незакрытая рутина");
                            if (!hadReportYesterday) reasonParts.push("нет дневного отчёта");

                            if (user.currentDay > 7 && !user.isReadyForNextWeek) {
                                reasonParts.push("невыполненные глобальные задачи недели");
                            }

                            if (reasonParts.length > 0) {
                                user.strikes = (user.strikes || 0) + 1;
                                
                                if (user.strikes >= 5) {
                                    const isCreator = user.telegramId.toString() === process.env.CREATOR_ID;
                                    if (isCreator) {
                                        user.strikes = 0;
                                        await bot.api.sendMessage(user.telegramId, "<b>[АДМИН-СТАТУС]</b> Ты набрал 5 страйков, но как создатель системы ты выше блокировок. Страйки обнулены. Но Сэнсэй всё равно недоволен.", { parse_mode: 'HTML' });
                                    } else {
                                        user.frozen = true;
                                        await bot.api.sendMessage(user.telegramId, "<b>ФИНИШ.</b> Ты набрал 5 страйков. Ты заморожен. Иди и думай.", { parse_mode: 'HTML' });
                                    }
                                } else {
                                    const tone = getTone(user.currentWeek);
                                    await bot.api.sendMessage(user.telegramId, `${tone.strike} Причина: ${reasonParts.join(' и ')}. У тебя ${user.strikes}/5 страйков.`, { parse_mode: 'HTML' });
                                }
                            }
                            await user.save();
                        }
                        continue;
                    }
                } catch (e) {
                    console.error(`Failed cron for user ${user.telegramId}`, e.message);
                }
            }

            try {
                const https = await import('https');
                https.get('https://hc-ping.com/083eb4e3-8038-43c4-aada-e80c6359b0b7').on('error', (e) => {
                    console.error('Healthcheck ping error:', e.message);
                });
            } catch (err) {
                console.error('Failed to send healthcheck ping:', err.message);
            }

        } catch (error) {
            console.error('Error in minute cron job:', error);
        }
    });

    cron.schedule('0 3 * * *', async () => {
        try {
            console.log("Running auto-cleanup job (03:00)...");
            const thirtyDaysAgo = DateTime.now().minus({ days: 30 }).toJSDate();

            const inactiveUsers = await User.find({ lastActivityAt: { $lt: thirtyDaysAgo } });

            for (const user of inactiveUsers) {
                console.log(`Cleaning up inactive user: ${user.telegramId}`);
                await Report.deleteMany({ userId: user._id });
                await CustomTask.deleteMany({ userId: user._id });
                await User.deleteOne({ _id: user._id });
            }
            if (inactiveUsers.length > 0) {
                console.log(`Cleaned up ${inactiveUsers.length} inactive users.`);
            }
        } catch (error) {
            console.error('Error in cleanup cron job:', error);
        }
    });
};

export default setupCronJobs;
