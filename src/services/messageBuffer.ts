import { BUFFER_SIZE } from '../config/constants';

/** Структура одного сообщения в буфере */
export interface BufferedMessage {
    /** Имя отправителя */
    name: string;
    /** Текст сообщения */
    text: string;
    /** Время получения (timestamp в мс) */
    timestamp: number;
    /** Сообщение адресовано боту (реплай, упоминание, триггер-слово) */
    addressedToBot: boolean;
    /** Имя автора сообщения, на которое ответили (если реплай) */
    replyTo?: string;
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
