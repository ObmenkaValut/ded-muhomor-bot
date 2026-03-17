import { Context, InlineKeyboard } from 'grammy';
import { REPLY_CHANCE, COOLDOWN_MS, ALLOWED_CHAT_USERNAMES } from '../config/constants';
import { addMessage, getMessages, BufferedMessage } from '../services/messageBuffer';
import { askGemini, checkProfanity, checkPurchaseIntent, ImageData } from '../services/gemini';

/** Кулдаун: chatId → timestamp последнего ответа бота */
const lastReplyTime = new Map<number, number>();

/**
 * Проверяет, находится ли бот в кулдауне для данного чата.
 * Если нет — обновляет timestamp.
 */
function isOnCooldown(chatId: number): boolean {
    const now = Date.now();
    const lastTime = lastReplyTime.get(chatId) ?? 0;
    return now - lastTime < COOLDOWN_MS;
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
 * Скачивает фото из Telegram и возвращает base64 + mimeType.
 * Берёт самое большое фото (последнее в массиве).
 */
async function downloadPhoto(ctx: Context): Promise<ImageData | undefined> {
    const photo = ctx.message?.photo;
    if (!photo || photo.length === 0) return undefined;

    try {
        // Берём самое большое фото
        const largest = photo[photo.length - 1];
        const file = await ctx.api.getFile(largest.file_id);

        if (!file.file_path) {
            console.error('[error] Telegram не вернул file_path для фото');
            return undefined;
        }

        const botToken = process.env.BOT_TOKEN;
        const url = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;

        const response = await fetch(url);
        if (!response.ok) {
            console.error(`[error] Не удалось скачать фото: ${response.status}`);
            return undefined;
        }

        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');

        // Определяем mimeType по расширению
        const ext = file.file_path.split('.').pop()?.toLowerCase();
        const mimeMap: Record<string, string> = {
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            png: 'image/png',
            webp: 'image/webp',
            gif: 'image/gif',
        };
        const mimeType = mimeMap[ext ?? ''] ?? 'image/jpeg';

        console.log(`[photo] Скачано фото: ${Math.round(buffer.byteLength / 1024)} KB, ${mimeType}`);
        return { base64, mimeType };
    } catch (error) {
        console.error('[error] Ошибка скачивания фото:', error);
        return undefined;
    }
}

/**
 * Главный обработчик сообщений в группах (текст + фото).
 */
export async function handleGroupMessage(ctx: Context): Promise<void> {
    const msg = ctx.message;
    if (!msg) return;

    // Определяем текст: обычный текст или подпись к фото
    const text = msg.text ?? msg.caption ?? '';
    const hasPhoto = !!msg.photo && msg.photo.length > 0;

    // Пропускаем сообщения без текста и без фото
    if (!text && !hasPhoto) return;

    // Только группы и супергруппы
    const chat = ctx.chat;
    if (!chat) return;
    if (chat.type !== 'group' && chat.type !== 'supergroup') return;

    // Проверяем юзернейм чата — если не в списке разрешённых, уходим
    const chatUsername = 'username' in chat ? chat.username : undefined;
    if (!chatUsername || !ALLOWED_CHAT_USERNAMES.includes(chatUsername)) {
        console.log(`[skip] Неверифицированный чат (${chatUsername ?? 'без username'}), ухожу из ${chat.id}`);
        try {
            await ctx.api.leaveChat(chat.id);
        } catch (error) {
            console.error(`[error] Не удалось покинуть чат ${chat.id}:`, error);
        }
        return;
    }

    const chatId = chat.id;
    const botUsername = process.env.BOT_USERNAME ?? '';
    const botId = ctx.me.id;

    // Не отвечаем на свои сообщения
    if (ctx.from?.id === botId) return;

    // ИИ-модерация мата (только если есть текст)
    if (text) {
        const isProfane = await checkProfanity(text);
        if (isProfane) {
            console.log(`[moderation] Найден мат, удаляю сообщение от ${ctx.from?.username || ctx.from?.first_name} в чате ${chatId}`);
            try {
                await ctx.deleteMessage();
            } catch (e) {
                console.error(`[error] Не удалось удалить сообщение (проверь права админа у бота) в чате ${chatId}:`, e);
            }
            return;
        }

        // ИИ-проверка намерений покупки (ассортимент, цена, купить)
        // Генерируем временный буфер, чтобы модель видела контекст + текущее сообщение
        const tempBuffer = [...getMessages(chatId), {
            name: ctx.from?.username || ctx.from?.first_name || 'Аноним',
            text: text,
            timestamp: Date.now(),
            addressedToBot: false
        }];

        const isPurchase = await checkPurchaseIntent(tempBuffer);
        if (isPurchase) {
            console.log(`[intent] Обнаружен вопрос о покупке от ${ctx.from?.username || ctx.from?.first_name} в чате ${chatId}`);

            const replyText = `Если хочешь что-то купить или узнать про ассортимент — заглядывай в бот: @CyberpusherBot\n\nА если он вдруг начнет глючить, пиши нашей @MMuhomorov`;
            const keyboard = new InlineKeyboard()
                .url('Перейти в магазин →', 'https://t.me/CyberpusherBot');

            try {
                await ctx.reply(replyText, {
                    reply_to_message_id: msg.message_id,
                    reply_markup: keyboard,
                });

                // Добавляем автоматический ответ в буфер, чтобы Дед видел, что мы уже ответили 
                addMessage(chatId, {
                    name: 'Дед Пенькович',
                    text: replyText,
                    timestamp: Date.now(),
                    addressedToBot: false,
                });
            } catch (e) {
                console.error(`[error] Ошибка отправки сообщения о покупке в чат ${chatId}:`, e);
            }
            return; // Завершаем обработку, чтобы не дергать Деда
        }
    }

    const senderName = getSenderName(ctx);

    // Проверяем: это реплай на сообщение бота, упоминание или обращение по имени?
    const isReplyToBot = msg.reply_to_message?.from?.id === botId;
    const isMention = botUsername
        ? text.toLowerCase().includes(`@${botUsername.toLowerCase()}`)
        : false;

    // Ключевые слова, по которым дед понимает, что обращаются к нему
    const isReplyToOther = msg.reply_to_message?.from?.id !== undefined
        && msg.reply_to_message.from.id !== botId;
    const triggerWords = ['дед', 'мухомор', 'дедуля', 'дедуль', 'дедушка', 'дедуган'];
    const lowerText = text.toLowerCase();
    const isDirectAddress = !isReplyToOther && triggerWords.some((word) => lowerText.includes(word));

    const mustReply = isReplyToBot || isMention || isDirectAddress;

    // Определяем, на чьё сообщение это реплай
    const replyMsg = msg.reply_to_message;
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
        text: text || '[📷 фото]',
        timestamp: Date.now(),
        addressedToBot: mustReply,
        replyTo: replyToName,
        hasImage: hasPhoto,
    };
    addMessage(chatId, bufferedMessage);

    // Проверяем кулдаун (пропускаем только для mustReply)
    if (!mustReply && isOnCooldown(chatId)) {
        console.log(`[skip] Молчу (кулдаун) в чате ${chatId}`);
        return;
    }

    // Если не mustReply — бросаем монетку
    if (!mustReply) {
        const roll = Math.random();
        if (roll > REPLY_CHANCE) {
            console.log(`[skip] Молчу (рандом ${(roll * 100).toFixed(0)}% > ${REPLY_CHANCE * 100}%) в чате ${chatId}`);
            return;
        }
    }

    // Скачиваем фото, если оно в последнем сообщении
    let imageData: ImageData | undefined;
    if (hasPhoto) {
        imageData = await downloadPhoto(ctx);
    }

    // Вызываем Gemini, пока показываем "Печатает..."
    const messages = getMessages(chatId);

    // Telegram сбрасывает "Печатает..." через 5 сек — обновляем каждые 4
    const typingInterval = setInterval(() => {
        ctx.api.sendChatAction(chatId, 'typing').catch(() => { });
    }, 4_000);
    void ctx.api.sendChatAction(chatId, 'typing').catch(() => { });

    const geminiResult = await askGemini(messages, mustReply, imageData);

    if (geminiResult.reply && geminiResult.text) {
        // Проверяем кулдаун ещё раз (мог истечь пока ждали Gemini)
        if (!mustReply && isOnCooldown(chatId)) {
            clearInterval(typingInterval);
            console.log(`[skip] Молчу (кулдаун после Gemini) в чате ${chatId}`);
            return;
        }

        // Задержка 3–6 сек для эмуляции живого человека
        const delay = 3_000 + Math.random() * 3_000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        clearInterval(typingInterval);

        console.log(`[reply] Отвечаю в чате ${chatId}: "${geminiResult.text}"`);
        updateCooldown(chatId);

        try {
            await ctx.reply(geminiResult.text, {
                reply_to_message_id: msg.message_id,
            });

            // Добавляем свой ответ в буфер, чтобы Gemini видел полный контекст
            addMessage(chatId, {
                name: 'Дед Пенькович',
                text: geminiResult.text,
                timestamp: Date.now(),
                addressedToBot: false,
            });
        } catch (error) {
            console.error(`[error] Ошибка отправки сообщения в чат ${chatId}:`, error);
        }
    } else {
        clearInterval(typingInterval);
        console.log(`[skip] Молчу (Gemini решил) в чате ${chatId}`);
    }
}
