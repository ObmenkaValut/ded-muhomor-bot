/** Константы проекта "Дед Мухомор" */

/** Максимальное количество сообщений в буфере на один чат */
export const BUFFER_SIZE = 30;

/** Шанс ответить на обычное сообщение (от 0 до 1) */
export const REPLY_CHANCE = 0.3;

/** Кулдаун между ответами бота в одном чате (в миллисекундах) */
export const COOLDOWN_MS = 30_000;




/** Модель Gemini для персонажа */
export const GEMINI_MODEL = 'gemini-2.5-flash';

/** Модель Gemini для модерации (дёшевая, быстрая) */
export const MODERATION_MODEL = 'gemini-2.5-flash-lite';

/** Температура генерации Gemini */
export const GEMINI_TEMPERATURE = 0.6;

/** Разрешённые юзернеймы чатов (без @) */
export const ALLOWED_CHAT_USERNAMES = ['MUHOMORYE', 'fwfwfwfwfw1'];
