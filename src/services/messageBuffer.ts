import { BUFFER_SIZE, CLEANUP_INTERVAL_MS, MAX_MESSAGE_AGE_MS } from '../config/constants';

/** Структура одного сообщения в буфере */
export interface BufferedMessage {
    /** Имя отправителя */
    name: string;
    /** Текст сообщения */
    text: string;
    /** Время получения (timestamp в мс) */
    timestamp: number;
    /** Является ли реплаем на сообщение бота */
    isReplyToBot: boolean;
}

/** Хранилище последних N сообщений для каждого чата (in-memory) */
const chatBuffers = new Map<number, BufferedMessage[]>();

/**
 * Добавляет сообщение в буфер чата.
 * Автоматически удаляет самое старое, если буфер переполнен.
 */
export function addMessage(chatId: number, message: BufferedMessage): void {
    const buffer = chatBuffers.get(chatId) ?? [];

    buffer.push(message);

    // Удаляем самое старое сообщение, если буфер переполнен
    if (buffer.length > BUFFER_SIZE) {
        buffer.shift();
    }

    chatBuffers.set(chatId, buffer);
}

/** Возвращает буфер сообщений для чата */
export function getMessages(chatId: number): BufferedMessage[] {
    return chatBuffers.get(chatId) ?? [];
}

/**
 * Очистка устаревших записей.
 * Удаляет сообщения старше MAX_MESSAGE_AGE_MS и пустые буферы.
 */
function cleanupOldMessages(): void {
    const now = Date.now();
    let totalCleaned = 0;

    for (const [chatId, buffer] of chatBuffers.entries()) {
        const before = buffer.length;
        const filtered = buffer.filter((msg) => now - msg.timestamp < MAX_MESSAGE_AGE_MS);

        if (filtered.length === 0) {
            chatBuffers.delete(chatId);
            totalCleaned += before;
        } else if (filtered.length !== before) {
            chatBuffers.set(chatId, filtered);
            totalCleaned += before - filtered.length;
        }
    }

    if (totalCleaned > 0) {
        console.log(`🧹 Очистка буфера: удалено ${totalCleaned} устаревших сообщений`);
    }
}

/** Запуск периодической очистки буферов */
export function startCleanupInterval(): NodeJS.Timeout {
    return setInterval(cleanupOldMessages, CLEANUP_INTERVAL_MS);
}
