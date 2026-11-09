/** Константы проекта "Дед Мухомор" */

/** Максимальное количество сообщений в буфере на один чат */
export const BUFFER_SIZE = 30;

/** Шанс ответить на обычное сообщение (от 0 до 1) */
export const REPLY_CHANCE = 0.3;

/** Кулдаун между ответами бота в одном чате (в миллисекундах) */
export const COOLDOWN_MS = 30_000;

/** Через сколько удалять приветствие нового участника (в миллисекундах) */
export const WELCOME_DELETE_MS = 60_000;

/*
 * ЗАДЕРЖКА ОТВЕТА ДЕДА
 * Сейчас: Gemini → пауза «прочитал» (READ_DELAY) → «печатает…» по длине текста (TYPING_*) → отправка.
 * Ответ готовится в фоне (composeAndSendReply в handlers/groupMessage.ts), бот не блокируется.
 *
 * КАК БЫЛО ДО ЭТОГО: сразу «печатает…» → Gemini → фиксированная пауза 10–20 сек → отправка,
 * всё через await прямо в обработчике (на время паузы бот не обрабатывал другие сообщения).
 * Откатиться: git log --oneline --grep="slower human-like" → git revert <hash>
 */

/** Пауза «прочитал и подумал» перед ответом деда, без индикатора «печатает» (мс) */
export const READ_DELAY_MIN_MS = 15_000;
export const READ_DELAY_MAX_MS = 40_000;

/** Скорость печати деда (символов в секунду) — от неё зависит, сколько горит «печатает…» */
export const TYPING_CHARS_PER_SEC = 4;

/** Границы времени «печатает…» (мс) */
export const TYPING_MIN_MS = 4_000;
export const TYPING_MAX_MS = 30_000;




/** Модель Gemini для персонажа */
export const GEMINI_MODEL = 'gemini-2.5-flash';

/** Модель Gemini для модерации (дёшевая, быстрая) */
export const MODERATION_MODEL = 'gemini-2.5-flash-lite';

/** Температура генерации Gemini */
export const GEMINI_TEMPERATURE = 0.8;

/** Разрешённые юзернеймы чатов (без @) */
export const ALLOWED_CHAT_USERNAMES = ['MUHOMORYE', 'fwfwfwfwfw1'];
