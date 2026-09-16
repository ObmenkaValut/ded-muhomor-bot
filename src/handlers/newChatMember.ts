import { Context } from 'grammy';
import type { ChatMember } from 'grammy/types';
import { ALLOWED_CHAT_USERNAMES, WELCOME_DELETE_MS } from '../config/constants';

/** Текст приветствия для нового участника */
function buildWelcomeText(firstName: string): string {
    return `${firstName}, привет 🙌🏻

У НАС ЕСТЬ ПРАВИЛА:
· Уважай себя и собеседника.
· Формулируй мысли чётко.
· Не навязывай своё мнение, не осуждай и не поучай, если тебя об этом не попросили.
· Не согласен с кем-то — тактично мотивируй своё мнение.
· Следи за чистотой своей речи.

Заказать продукцию можно через наш чат-бот:
@herbyshop_bot

Если есть проблемы с ботом, напиши нашему менеджеру:
@MMuhomorov`;
}

/** Состоит ли пользователь в чате при данном статусе */
function isInChat(member: ChatMember): boolean {
    if (member.status === 'restricted') return member.is_member;
    return member.status !== 'left' && member.status !== 'kicked';
}

/**
 * Приветствует нового участника группы.
 * Приветствие удаляется через WELCOME_DELETE_MS.
 */
export async function handleNewChatMember(ctx: Context): Promise<void> {
    const update = ctx.chatMember;
    if (!update) return;

    // Только вступление: раньше не был в чате, теперь в чате
    if (isInChat(update.old_chat_member) || !isInChat(update.new_chat_member)) return;

    const user = update.new_chat_member.user;
    if (user.is_bot) return;

    const chat = update.chat;
    const chatUsername = 'username' in chat ? chat.username : undefined;
    if (!chatUsername || !ALLOWED_CHAT_USERNAMES.includes(chatUsername)) return;

    try {
        const sent = await ctx.api.sendMessage(chat.id, buildWelcomeText(user.first_name));
        console.log(`[welcome] Поприветствовал ${user.username || user.first_name} в чате ${chat.id}`);

        setTimeout(() => {
            ctx.api.deleteMessage(chat.id, sent.message_id).catch((e) => {
                console.error(`[error] Не удалось удалить приветствие в чате ${chat.id}:`, e);
            });
        }, WELCOME_DELETE_MS);
    } catch (e) {
        console.error(`[error] Ошибка отправки приветствия в чат ${chat.id}:`, e);
    }
}
