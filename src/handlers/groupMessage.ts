import { Context } from 'grammy';
import { REPLY_CHANCE, COOLDOWN_MS, ALLOWED_CHAT_USERNAMES } from '../config/constants';
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

    // Проверяем юзернейм чата — если не в списке разрешённых, уходим
    const chatUsername = 'username' in chat ? chat.username : undefined;
    if (!chatUsername || !ALLOWED_CHAT_USERNAMES.includes(chatUsername)) {
        console.log(`🚪 Неверифицированный чат (${chatUsername ?? 'без username'}), ухожу из ${chat.id}`);
        try {
            await ctx.api.leaveChat(chat.id);
        } catch (error) {
            console.error(`❌ Не удалось покинуть чат ${chat.id}:`, error);
        }
        return;
    }

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
    const triggerWords = ['дед', 'мухомор', 'дедуля', 'дедуль', 'дедушка', 'дедуган'];
    const lowerText = text.toLowerCase();
    const isDirectAddress = triggerWords.some((word) => lowerText.includes(word));

    const mustReply = isReplyToBot || isMention || isDirectAddress;

    // Определяем, на чьё сообщение это реплай
    const replyMsg = ctx.message.reply_to_message;
    let replyToName: string | undefined;
    if (replyMsg?.from) {
        if (replyMsg.from.id === botId) {
            replyToName = 'Дед Пенькович';
        } else {
            replyToName = replyMsg.from.first_name || replyMsg.from.username || undefined;
        }
    }

    // Добавляем сообщение в буфер
    const bufferedMessage: BufferedMessage = {
        name: senderName,
        text,
        timestamp: Date.now(),
        isReplyToBot: mustReply,
        replyTo: replyToName,
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

    // Вызываем Gemini, пока показываем "Печатает..."
    const messages = getMessages(chatId);

    // Telegram сбрасывает "Печатает..." через 5 сек — обновляем каждые 4
    const typingInterval = setInterval(() => {
        ctx.api.sendChatAction(chatId, 'typing').catch(() => { });
    }, 4_000);
    void ctx.api.sendChatAction(chatId, 'typing').catch(() => { });

    const geminiResult = await askGemini(messages, mustReply);

    if (geminiResult.reply && geminiResult.text) {
        // Проверяем кулдаун ещё раз (мог истечь пока ждали Gemini)
        if (!mustReply && isOnCooldown(chatId)) {
            clearInterval(typingInterval);
            console.log(`🤫 Молчу (кулдаун после Gemini) в чате ${chatId}`);
            return;
        }

        // Задержка 3–6 сек для эмуляции живого человека
        const delay = 3_000 + Math.random() * 3_000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        clearInterval(typingInterval);

        console.log(`🍄 Отвечаю в чате ${chatId}: "${geminiResult.text}"`);
        updateCooldown(chatId);

        try {
            await ctx.reply(geminiResult.text, {
                reply_to_message_id: ctx.message.message_id,
            });

            // Добавляем свой ответ в буфер, чтобы Gemini видел полный контекст
            addMessage(chatId, {
                name: 'Дед Пенькович',
                text: geminiResult.text,
                timestamp: Date.now(),
                isReplyToBot: false,
            });
        } catch (error) {
            console.error(`❌ Ошибка отправки сообщения в чат ${chatId}:`, error);
        }
    } else {
        clearInterval(typingInterval);
        console.log(`🤫 Молчу (Gemini решил) в чате ${chatId}`);
    }
}
