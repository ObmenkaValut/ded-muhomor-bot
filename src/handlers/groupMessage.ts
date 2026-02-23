import { Context } from 'grammy';
import { REPLY_CHANCE, COOLDOWN_MS } from '../config/constants';
import { addMessage, getMessages, BufferedMessage } from '../services/messageBuffer';
import { askGemini } from '../services/gemini';

/** Кулдаун: chatId → timestamp последнего ответа бота */
const lastReplyTime = new Map<number, number>();

/**
 * Проверяет, находится ли бот в кулдауне для данного чата.
 * Если нет — обновляет timestamp.
 */
function isOnCooldown(chatId: number): boolean {
    const now = Date.now();
    const lastTime = lastReplyTime.get(chatId) ?? 0;

    if (now - lastTime < COOLDOWN_MS) {
        return true;
    }

    return false;
}

/** Обновляет timestamp последнего ответа */
function updateCooldown(chatId: number): void {
    lastReplyTime.set(chatId, Date.now());
}

/**
 * Возвращает отображаемое имя пользователя.
 */
function getSenderName(ctx: Context): string {
    const user = ctx.from;
    if (!user) return 'Аноним';

    if (user.first_name && user.last_name) {
        return `${user.first_name} ${user.last_name}`;
    }

    return user.first_name || user.username || 'Аноним';
}

/**
 * Главный обработчик текстовых сообщений в группах.
 */
export async function handleGroupMessage(ctx: Context): Promise<void> {
    // Только текстовые сообщения
    if (!ctx.message?.text) return;

    // Только группы и супергруппы
    const chat = ctx.chat;
    if (!chat) return;
    if (chat.type !== 'group' && chat.type !== 'supergroup') return;

    const chatId = chat.id;
    const botUsername = process.env.BOT_USERNAME ?? '';
    const botId = ctx.me.id;

    // Не отвечаем на свои сообщения
    if (ctx.from?.id === botId) return;

    const text = ctx.message.text;
    const senderName = getSenderName(ctx);

    // Проверяем: это реплай на сообщение бота, упоминание или обращение по имени?
    const isReplyToBot = ctx.message.reply_to_message?.from?.id === botId;
    const isMention = botUsername
        ? text.toLowerCase().includes(`@${botUsername.toLowerCase()}`)
        : false;

    // Ключевые слова, по которым дед понимает, что обращаются к нему
    const triggerWords = ['дед', 'дедуля', 'дедуль', 'дедушка', 'дедуган'];
    const lowerText = text.toLowerCase();
    const isDirectAddress = triggerWords.some((word) => lowerText.includes(word));

    const mustReply = isReplyToBot || isMention || isDirectAddress;

    // Добавляем сообщение в буфер
    const bufferedMessage: BufferedMessage = {
        name: senderName,
        text,
        timestamp: Date.now(),
        isReplyToBot: mustReply,
    };
    addMessage(chatId, bufferedMessage);

    // Проверяем кулдаун (пропускаем только для mustReply)
    if (!mustReply && isOnCooldown(chatId)) {
        console.log(`🤫 Молчу (кулдаун) в чате ${chatId}`);
        return;
    }

    // Если не mustReply — бросаем монетку
    if (!mustReply) {
        const roll = Math.random();
        if (roll > REPLY_CHANCE) {
            console.log(`🤫 Молчу (рандом ${(roll * 100).toFixed(0)}% > ${REPLY_CHANCE * 100}%) в чате ${chatId}`);
            return;
        }
    }

    // Вызываем Gemini
    const messages = getMessages(chatId);
    const geminiResult = await askGemini(messages, mustReply);

    if (geminiResult.reply && geminiResult.text) {
        // Проверяем кулдаун ещё раз (мог истечь пока ждали Gemini)
        if (!mustReply && isOnCooldown(chatId)) {
            console.log(`🤫 Молчу (кулдаун после Gemini) в чате ${chatId}`);
            return;
        }

        console.log(`🍄 Отвечаю в чате ${chatId}: "${geminiResult.text}"`);
        updateCooldown(chatId);

        try {
            await ctx.reply(geminiResult.text, {
                reply_to_message_id: ctx.message.message_id,
            });

            // Добавляем свой ответ в буфер, чтобы Gemini видел полный контекст
            addMessage(chatId, {
                name: 'Дед Мухомор',
                text: geminiResult.text,
                timestamp: Date.now(),
                isReplyToBot: false,
            });
        } catch (error) {
            console.error(`❌ Ошибка отправки сообщения в чат ${chatId}:`, error);
        }
    } else {
        console.log(`🤫 Молчу (Gemini решил) в чате ${chatId}`);
    }
}
