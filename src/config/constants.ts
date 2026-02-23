/** Константы проекта "Дед Мухомор" */

/** Максимальное количество сообщений в буфере на один чат */
export const BUFFER_SIZE = 30;

/** Шанс ответить на обычное сообщение (от 0 до 1) */
export const REPLY_CHANCE = 0.3;

/** Кулдаун между ответами бота в одном чате (в миллисекундах) */
export const COOLDOWN_MS = 30_000;

/** Интервал очистки устаревших буферов (в миллисекундах) */
export const CLEANUP_INTERVAL_MS = 10 * 60 * 1_000; // 10 минут

/** Максимальный возраст записи в буфере (в миллисекундах) */
export const MAX_MESSAGE_AGE_MS = 2 * 60 * 60 * 1_000; // 2 часа

/** Таймаут запроса к Gemini (в миллисекундах) */
export const GEMINI_TIMEOUT_MS = 15_000;

/** Модель Gemini */
export const GEMINI_MODEL = 'gemini-2.5-flash-lite';

/** Температура генерации Gemini */
export const GEMINI_TEMPERATURE = 1.5;

/** Разрешённые юзернеймы чатов (без @) */
export const ALLOWED_CHAT_USERNAMES = ['MUHOMORYE'];
