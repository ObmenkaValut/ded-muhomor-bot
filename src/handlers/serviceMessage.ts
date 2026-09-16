import { Context } from 'grammy';
import { ALLOWED_CHAT_USERNAMES } from '../config/constants';

/**
 * Удаляет служебные сообщения о вступлении и выходе участников.
 */
export async function handleServiceMessage(ctx: Context): Promise<void> {
    const chat = ctx.chat;
    if (!chat) return;

    const chatUsername = 'username' in chat ? chat.username : undefined;
    if (!chatUsername || !ALLOWED_CHAT_USERNAMES.includes(chatUsername)) return;

    try {
        await ctx.deleteMessage();
    } catch (e) {
        console.error(`[error] Не удалось удалить служебное сообщение в чате ${chat.id}:`, e);
    }
}
