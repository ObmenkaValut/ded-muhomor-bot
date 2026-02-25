import 'dotenv/config';
import { Bot } from 'grammy';
import { handleGroupMessage } from './handlers/groupMessage';
import { startCleanupInterval } from './services/messageBuffer';

/** Проверяем обязательные переменные окружения */
function validateEnv(): void {
    const required = ['BOT_TOKEN', 'GEMINI_API_KEY', 'BOT_USERNAME'] as const;
    const missing = required.filter((key) => !process.env[key]);

    if (missing.length > 0) {
        throw new Error(`Отсутствуют переменные окружения: ${missing.join(', ')}`);
    }
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

    // Graceful shutdown
    const shutdown = () => {
        console.log('[stop] Дед Пенькович ложится спать...');
        clearInterval(cleanupTimer);
        bot.stop();
    };

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);

    // Запуск long polling
    console.log('[start] Дед Пенькович проснулся!');
    await bot.start({
        allowed_updates: [],
    });
}

main().catch((error) => {
    console.error('[fatal] Фатальная ошибка при запуске:', error);
    process.exit(1);
});
