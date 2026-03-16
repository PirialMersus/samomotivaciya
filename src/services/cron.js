import cron from 'node-cron';
import User from '../models/User.js';
import methodology from '../data/methodology.js';
import { InlineKeyboard } from 'grammy';
import { DateTime } from 'luxon';

const setupCronJobs = (bot) => {
    // Единый джоб, работающий каждую минуту
    cron.schedule('* * * * *', async () => {
        try {
            const users = await User.find({ frozen: false });
            for (const user of users) {
                try {
                    const tz = user.timezone || 'Europe/Kyiv';
                    const dt = DateTime.now().setZone(tz);
                    const todayStr = dt.toFormat('yyyy-MM-dd');

                    // Утро 07:00
                    if (dt.hour === 7 && dt.minute === 0) {
                        const weekData = methodology.weeks[user.currentWeek];
                        if (!weekData) continue;

                        let msgText = `<b>УТРО, САЛАГА!</b>\n07:00 на твоих часах.\n\n<b>Неделя ${user.currentWeek}: ${weekData.title}</b>\n`;
                        
                        if (user.currentWeek === 2) {
                            msgText += `\nВстал. Выпил 500мл воды. Бросил лед в тазик. Начинай бег натощак. Доложи о готовности.\n`;
                        } else if (user.currentWeek === 4) {
                            msgText += `\n8 километров сами себя не пройдут. Вставай и насыщай мозг кислородом. Отдавай, чтобы получать.\n`;
                        } else {
                            msgText += `\nНиже твоя рутина на сегодня. Жми кнопки по мере выполнения.\n`;
                        }

                        if (weekData.global_tasks?.length > 0) {
                            msgText += `\n<b>Глобальные задачи недели:</b>\n`;
                            weekData.global_tasks.forEach(t => {
                                const isDone = user.completedGlobalTasks?.includes(t.id);
                                const icon = t.isPersistent ? '🔄' : (isDone ? '✅' : '❌');
                                msgText += `🔥 ${t.title} ${icon}\n`;
                            });
                        }

                        if (weekData.taboo?.length > 0) {
                            msgText += `\n<b>⚠️ ТАБУ:</b>\n• ${weekData.taboo.join('\n• ')}\n`;
                        }

                        await bot.api.sendMessage(user.telegramId, msgText, { parse_mode: 'HTML' });

                        for (const task of weekData.daily_routine) {
                            const isDone = user.progress?.get(`${task.id}_${todayStr}`);
                            if (!isDone) {
                                const keyboard = new InlineKeyboard()
                                    .text(`Сделал ✅: ${task.title}`, `done:${task.id}`)
                                    .row()
                                    .text(`Напомни позже ⏳`, `remind_later`);
                                await bot.api.sendMessage(user.telegramId, `Задача: <b>${task.title}</b>`, {
                                    parse_mode: 'HTML',
                                    reply_markup: keyboard
                                });
                            }
                        }
                    }

                    // Утро 07:10 (Мантра Неделя 5)
                    if (user.currentWeek === 5 && dt.hour === 7 && dt.minute === 10) {
                        await bot.api.sendMessage(user.telegramId, "<b>Мантра прочитана?</b> Ты собрал себя или опять вышел в мир как разобранный механизм? Иди и делай центр.", { parse_mode: 'HTML' });
                    }

                    // Утро 07:05 (Мантра Неделя 9)
                    if (user.currentWeek === 9 && dt.hour === 7 && dt.minute === 5) {
                        await bot.api.sendMessage(user.telegramId, "<b>МАНТРА:</b> Твоя Мантра под подушкой? Прочитай её. Собери себя в охуенного человека прямо сейчас.", { parse_mode: 'HTML' });
                    }

                    // Утро 08:00 (План на год Неделя 10)
                    if (user.currentWeek === 10 && dt.hour === 8 && dt.minute === 0) {
                        await bot.api.sendMessage(user.telegramId, "<b>ПЛАН НА ГОД:</b> План перед глазами? Что ты сделаешь сегодня, чтобы закрыть результат этой недели? Время идет.", { parse_mode: 'HTML' });
                    }

                    // Рандомные проверки днем (Неделя 2 и 3)
                    if (dt.hour >= 10 && dt.hour <= 20) {
                        // Шанс примерно раз в день (1 из 600 минут)
                        if (Math.random() < 0.0015) {
                            if (user.currentWeek === 2) {
                                await bot.api.sendMessage(user.telegramId, "<b>Сэнсэй видит всё.</b> Ты сейчас в лифте или на лестнице? Оправданий не принимаю.", { parse_mode: 'HTML' });
                            } else if (user.currentWeek === 3) {
                                await bot.api.sendMessage(user.telegramId, "<b>ПРОВЕРКА ВНИМАНИЯ.</b> Куда сейчас направлено твое внимание? В себя? На других? На цели? Или ты витаешь в облаках? Вернись в центр.", { parse_mode: 'HTML' });
                            } else if (user.currentWeek === 7) {
                                await bot.api.sendMessage(user.telegramId, "<b>Сэнсэй на связи.</b> Какой звук ты услышал первым? Какой образ увидел? Или сначала было ощущение? Не дай привычке управлять твоим восприятием.", { parse_mode: 'HTML' });
                            }
                        }
                    }

                    // Вечерняя шавасана (Неделя 3)
                    if (user.currentWeek === 3 && dt.hour === 22 && dt.minute === 0) {
                        await bot.api.sendMessage(user.telegramId, "<b>Сэнсэй советует.</b> Готовься к отбою. Помни: расслабление без внимания — это просто сон, а нам нужна осознанная разгрузка. Делай Шавасану правильно.", { parse_mode: 'HTML' });
                    }

                    // Вечерний запрос полезности (Неделя 4)
                    if (user.currentWeek === 4 && dt.hour === 21 && dt.minute === 0) {
                        await bot.api.sendMessage(user.telegramId, "<b>Доклад:</b> Кому ты сегодня был полезен? Какие новые орбиты прощупал? Если никому — день прожит зря. Исправляйся завтра.", { parse_mode: 'HTML' });
                    }

                    // Вечерние 3 чуда (Неделя 5)
                    if (user.currentWeek === 5 && dt.hour === 23 && dt.minute === 0) {
                        await bot.api.sendMessage(user.telegramId, "<b>ВРЕМЯ ЧУДЕС.</b> Минута пошла. Назови 3 чуда за сегодня. Не успел за 60 секунд — завтра будь внимательнее. Фильтруй реальность.", { parse_mode: 'HTML' });
                    }

                    // Дневной запрос (Неделя 6)
                    if (user.currentWeek === 6 && dt.hour === 15 && dt.minute === 0) {
                        await bot.api.sendMessage(user.telegramId, "<b>ОТЧЕТ КОНТРОЛЕРУ:</b> Ты сегодня пользовался навигатором или заставил мозг работать? Где твои 3D-карты?", { parse_mode: 'HTML' });
                    }

                    // Вечерний запрос (Неделя 6)
                    if (user.currentWeek === 6 && dt.hour === 22 && dt.minute === 0) {
                        await bot.api.sendMessage(user.telegramId, "<b>ИНТЕЛЛЕКТУАЛЬНАЯ ВЫНОСЛИВОСТЬ:</b> Книга открыта? Конспект пишется? Или опять смотришь клипы с 15-секундной нарезкой? Включи мозг.", { parse_mode: 'HTML' });
                    }

                    // Воскресный дедлайн (Неделя 7)
                    if (user.currentWeek === 7 && dt.weekday === 7 && dt.hour === 12 && dt.minute === 0) {
                        await bot.api.sendMessage(user.telegramId, "<b>ДЕДЛАЙН БЛИЗКО.</b> Сегодня дедлайн генеральной чистки. Все отчеты за 6 недель должны быть в одном файле к полуночи. Если не успеешь — ты вне протокола.", { parse_mode: 'HTML' });
                    }

                    // Утро 08:00 (Неделя 8)
                    if (user.currentWeek === 8 && dt.hour === 8 && dt.minute === 0) {
                        await bot.api.sendMessage(user.telegramId, "<b>ТАЙМ-МЕНЕДЖМЕНТ:</b> Листок тайм-менеджмента готов? Каждые 10 минут ты должен знать, зачем ты живешь. Записывай.", { parse_mode: 'HTML' });
                    }

                    // Дневной запрос (Неделя 8)
                    if (user.currentWeek === 8 && dt.hour === 14 && dt.minute === 0) {
                        await bot.api.sendMessage(user.telegramId, "<b>МАСТЕРСТВО:</b> Ты сегодня видел Мастерство? Чему научился у других или опять считаешь себя самым умным?", { parse_mode: 'HTML' });
                    }

                    // Вечер 23:30 (Неделя 8)
                    if (user.currentWeek === 8 && dt.hour === 23 && dt.minute === 30) {
                        await bot.api.sendMessage(user.telegramId, "<b>СТАТИКА ДУХА:</b> Где видео твоей статики? Таймер в кадре был? Если нет — не зачет. Грузи отчет немедленно.", { parse_mode: 'HTML' });
                    }

                    // Вечер 23:15 (Неделя 9)
                    if (user.currentWeek === 9 && dt.hour === 23 && dt.minute === 15) {
                        await bot.api.sendMessage(user.telegramId, "<b>ТРИ ЧУДА ДНЯ:</b> Минута пошла. Вспомни 3 чуда. Время — это всё, что у тебя есть.", { parse_mode: 'HTML' });
                    }

                    // Вечер 23:30 (Неделя 10)
                    if (user.currentWeek === 10 && dt.hour === 23 && dt.minute === 30) {
                        await bot.api.sendMessage(user.telegramId, "<b>ИТОГИ ДНЯ:</b> Отчет. Сколько книг в прогрессе? Сколько наставников найдено? Помни про дедлайн.", { parse_mode: 'HTML' });
                    }

                    if (user.currentWeek === 12 && dt.hour === 23 && dt.minute === 30) {
                        await bot.api.sendMessage(user.telegramId, "<b>ХРАНИТЕЛЬ ПУТИ:</b> Где твоё Мастерство сегодня? Кому ты был полезен? Финальная неделя — покажи результат.", { parse_mode: 'HTML' });
                    }

                    if (user.currentWeek === 12 && dt.weekday === 7 && dt.hour === 20 && dt.minute === 0) {
                        await bot.api.sendMessage(user.telegramId, "<b>ДЕДЛАЙН:</b> Время вышло. Либо ты в списке победителей, либо остаешься в прошлом. Жду финальный видео-отзыв и генеральный отчет за 3 месяца.", { parse_mode: 'HTML' });
                    }

                    // Вечер 23:30 (Предупреждение)
                    if (dt.hour === 23 && dt.minute === 30) {
                        const weekData = methodology.weeks[user.currentWeek];
                        if (!weekData) continue;

                        let hasUndone = false;
                        for (const task of weekData.daily_routine) {
                            const isDone = user.progress?.get(`${task.id}_${todayStr}`);
                            if (!isDone) hasUndone = true;
                        }

                        if (hasUndone) {
                            await bot.api.sendMessage(user.telegramId, "<b>ВНИМАНИЕ!</b> 23:30. У тебя остались невыполненные задачи на сегодня. Если до полуночи не закроешь их — получишь страйк. Шевелись!", { parse_mode: 'HTML' });
                        }
                    }

                    // Полночь 00:00 (Проверка и наказание страйками)
                    if (dt.hour === 0 && dt.minute === 0) {
                        const dtYesterday = dt.minus({ days: 1 });
                        const yesterdayStr = dtYesterday.toFormat('yyyy-MM-dd');
                        const weekData = methodology.weeks[user.currentWeek];
                        if (!weekData) continue;

                        let hasUndone = false;
                        for (const task of weekData.daily_routine) {
                            const isDone = user.progress?.get(`${task.id}_${yesterdayStr}`);
                            if (!isDone) hasUndone = true;
                        }

                        if (hasUndone) {
                            user.strikes = (user.strikes || 0) + 1;
                            if (user.strikes >= 3) {
                                user.frozen = true;
                                await bot.api.sendMessage(user.telegramId, "<b>ФИНИШ.</b> Ты набрал 3 страйка (нытье или провалы). Ты заморожен и лишен голоса в этом чате. Переходи в оффлайн-режим и подумай над своим поведением.", { parse_mode: 'HTML' });
                            } else {
                                await bot.api.sendMessage(user.telegramId, `<b>СТРАЙК!</b> Ты не выполнил базовые задачи за прошлый день. У тебя ${user.strikes} страйка(ов) из 3 максимальных. Дальше — бан.`, { parse_mode: 'HTML' });
                            }
                            await user.save();
                        }
                    }
                } catch (e) {
                    console.error(`Failed cron for user ${user.telegramId}`, e.message);
                }
            }
        } catch (error) {
            console.error('Error in minute cron job:', error);
        }
    });
};

export default setupCronJobs;
