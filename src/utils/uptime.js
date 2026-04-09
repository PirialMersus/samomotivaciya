import { DateTime } from 'luxon';

const startTime = DateTime.now();

export const getStartTime = () => startTime;

export const getUptimeString = (timezone = 'Europe/Kyiv') => {
    const now = DateTime.now().setZone(timezone);
    const start = startTime.setZone(timezone);
    
    const diff = now.diff(start, ['hours', 'minutes']).toObject();
    
    const dateStr = start.toFormat('HH:mm dd.MM');
    
    let durationStr = '';
    const hours = Math.floor(diff.hours || 0);
    const minutes = Math.floor(diff.minutes || 0);
    
    if (hours > 0) durationStr += `${hours}ч `;
    durationStr += `${minutes}м`;
    
    return `Система онлайн с: <b>${dateStr}</b> (в работе ${durationStr})`;
};
