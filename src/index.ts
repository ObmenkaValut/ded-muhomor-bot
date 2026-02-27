import 'dotenv/config';
import { Bot } from 'grammy';
import { handleGroupMessage } from './handlers/groupMessage';
import { startCleanupInterval } from './services/messageBuffer';
import { logAndResetDaily, logAndResetMonthly } from './services/tokenCounter';

/** Проверяем обязательные переменные окружения */
function validateEnv(): void {
    const required = ['BOT_TOKEN', 'GEMINI_API_KEY', 'BOT_USERNAME'] as const;
    const missing = required.filter((key) => !process.env[key]);

    if (missing.length > 0) {
        throw new Error(`Отсутствуют переменные окружения: ${missing.join(', ')}`);
    }
}

/**
 * Запускает ежедневный/ежемесячный отчёт токенов в консоль.
 * Срабатывает в полночь МСК (UTC+3).
 */
function startTokenReports(): NodeJS.Timeout {
    const getMsUntilMidnightMsk = () => {
        const now = new Date();
        const msk = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
        const nextMidnight = new Date(msk);
        nextMidnight.setHours(24, 0, 0, 0);
        return nextMidnight.getTime() - msk.getTime();
    };

    const onMidnight = () => {
        const msk = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
        logAndResetDaily();
        // В первый день месяца — сбрасываем месячный счётчик
        if (msk.getDate() === 1) {
            logAndResetMonthly();
        }
    };

    const timer = setTimeout(() => {
        onMidnight();
        setInterval(onMidnight, 24 * 60 * 60 * 1_000);
    }, getMsUntilMidnightMsk());

    return timer;
}



async function main(): Promise<void> {
    validateEnv();

    const bot = new Bot(process.env.BOT_TOKEN as string);

    // Обработка всех текстовых сообщений
    bot.on('message:text', handleGroupMessage);

    // Глобальный обработчик ошибок
    bot.catch((err) => {
        console.error('[error] Ошибка бота:', err.error);
        console.error('Контекст обновления:', err.ctx?.update?.update_id);
    });

    // Запускаем периодическую очистку буферов
    const cleanupTimer = startCleanupInterval();

    // Запускаем ежедневный/месячный отчёт по токенам
    const reportTimer = startTokenReports();

    // Graceful shutdown
    const shutdown = () => {
        console.log('[stop] Дед Пенькович ложится спать...');
        clearInterval(cleanupTimer);
        clearTimeout(reportTimer);
        bot.stop();
    };

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);

    // Запуск long polling
    console.log('[start] Дед Пенькович проснулся!');
    await bot.start({
        allowed_updates: [],
        drop_pending_updates: true,
    });
}

main().catch((error) => {
    console.error('[fatal] Фатальная ошибка при запуске:', error);
    process.exit(1);
});
