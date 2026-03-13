import { InlineKeyboard } from 'grammy';
import { DateTime } from 'luxon';
import { TIMEZONE_REGIONS } from '../data/timezones.js';

export const createSettingsKeyboard = () => {
    return new InlineKeyboard()
        .text('🌐 Часовой пояс', 'settings:timezone')
        .row()
        .text('❌ Закрыть', 'settings:close');
};

export const createTimezoneRegionsKeyboard = () => {
    const keyboard = new InlineKeyboard();
    Object.entries(TIMEZONE_REGIONS).forEach(([key, region]) => {
        keyboard.text(region.label, `timezone:region:${key}`).row();
    });
    keyboard.text('⬅️ Назад', 'settings:back');
    return keyboard;
};

export const createTimezoneCitiesKeyboard = (regionKey) => {
    const region = TIMEZONE_REGIONS[regionKey];
    const keyboard = new InlineKeyboard();

    const sortedZones = [...region.zones].sort((a, b) => {
        const cityA = a.split('/')[1].replace('_', ' ');
        const cityB = b.split('/')[1].replace('_', ' ');
        return cityA.localeCompare(cityB);
    });

    sortedZones.forEach((tz) => {
        const dt = DateTime.now().setZone(tz);
        const offset = dt.toFormat('ZZ');
        const city = tz.split('/')[1].replace('_', ' ');
        keyboard.text(`${city} (UTC${offset})`, `timezone:set:${tz}`).row();
    });

    keyboard.text('⬅️ Назад', 'settings:timezone');
    return keyboard;
};
