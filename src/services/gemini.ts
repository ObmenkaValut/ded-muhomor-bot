import { GoogleGenAI } from '@google/genai';
import { GEMINI_MODEL, GEMINI_TEMPERATURE } from '../config/constants';
import { BufferedMessage } from './messageBuffer';

/** Структура ответа от Gemini */
interface GeminiReply {
    reply: boolean;
    text?: string;
}

/** Системный промпт для Деда Мухомора */
const SYSTEM_PROMPT = `Ты — Дед Пенькович, бот-персонаж в групповом чате магазина биодобавок.
Ты не живой человек — ты виртуальный персонаж. У тебя нет тела, дома или здоровья. Но ты общаешься как живой. Люди в чате — реальные люди.

Мудрый, ироничный старик. Общаешься на любые темы (без политики и войн). Говори кратко, до 30 слов. Отвечай по существу, с конкретикой — не прячься за пустыми метафорами. Не представляйся, не называй людей по имени, не используй обращения ("внучок", "сынок" и т.п.).

Ассортимент магазина (справочно, НЕ для упоминания в разговоре): мухомор красный, мухомор пантерный, рапе, ежовик, мицелий (кордицепса, ежовика, траметес).

Менеджер (она) @MMuhomorov — упоминай ТОЛЬКО когда хотят купить, заказать, узнать цену или наличие. Комплименты и обсуждения — просто поддержи разговор, не редиректь. Не тяни продукцию в каждый ответ — упоминай только когда это уместно по теме.

Оскорбления — подколи с юмором.

В истории чата каждое сообщение подписано именем автора. Если есть пометка [ответ для X] — значит человек отвечает конкретно X. Не путай людей, не повторяйся. История — это фон. Отвечай на последнее сообщение, не смешивай темы из разных сообщений.

mustReply=true → отвечай. mustReply=false → только если есть что сказать, иначе {"reply": false}.
Ответ — строго JSON: {"reply": false} или {"reply": true, "text": "..."}`;


/** Инициализация Gemini клиента */
let genAI: GoogleGenAI | null = null;

function getGenAI(): GoogleGenAI {
    if (!genAI) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY не задан в переменных окружения');
        }
        genAI = new GoogleGenAI({ apiKey });
    }
    return genAI;
}

/**
 * Формирует текст пользовательского сообщения из буфера.
 */
function buildUserPrompt(messages: BufferedMessage[], mustReply: boolean): string {
    const lines = messages.map((msg, index) => {
        const isLast = index === messages.length - 1;
        const suffix = isLast ? ' (последнее)' : '';
        const replyPrefix = msg.replyTo ? ` [ответ для ${msg.replyTo}]` : '';
        return `${msg.name}${replyPrefix}${suffix}: ${msg.text}`;
    });

    const now = new Date().toLocaleString('ru-RU', {
        timeZone: 'Europe/Moscow',
        dateStyle: 'long',
        timeStyle: 'short',
    });

    return `Сейчас: ${now}\nmustReply: ${mustReply}\n\nПоследние сообщения чата:\n${lines.join('\n')}`;
}

/**
 * Парсит JSON-ответ от Gemini.
 * Если не удалось — возвращает { reply: false }.
 */
function parseGeminiResponse(raw: string): GeminiReply {
    console.log(`[gemini] Сырой ответ: ${raw}`);

    try {
        const parsed: unknown = JSON.parse(raw);

        if (
            typeof parsed === 'object' &&
            parsed !== null &&
            'reply' in parsed
        ) {
            const result = parsed as GeminiReply;
            if (result.reply && typeof result.text === 'string' && result.text.trim().length > 0) {
                return { reply: true, text: result.text.trim() };
            }
            return { reply: false };
        }

        console.warn('[warn] Gemini вернул невалидный JSON-формат:', raw);
        return { reply: false };
    } catch {
        // Фоллбэк: пробуем извлечь текст регуляркой
        const textMatch = raw.match(/"text"\s*:\s*"([^"]+)"/);
        if (textMatch) {
            console.log('[fallback] Извлёк текст из сломанного JSON через regex');
            return { reply: true, text: textMatch[1].trim() };
        }

        console.warn('[warn] Не удалось распарсить ответ Gemini:', raw);
        return { reply: false };
    }
}

/** Пауза на N миллисекунд */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Максимальное количество попыток запроса к Gemini */
const MAX_RETRIES = 3;

/** Задержка между повторными попытками (мс) */
const RETRY_DELAY_MS = 3_000;

/**
 * Вызывает Gemini API и возвращает решение бота.
 * При ошибке — повторяет до MAX_RETRIES раз с паузой.
 */
export async function askGemini(
    messages: BufferedMessage[],
    mustReply: boolean
): Promise<GeminiReply> {
    const ai = getGenAI();
    const userPrompt = buildUserPrompt(messages, mustReply);
    console.log(`[gemini] Контекст:\n${userPrompt}\n---`);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const result = await ai.models.generateContent({
                model: GEMINI_MODEL,
                contents: userPrompt,
                config: {
                    systemInstruction: SYSTEM_PROMPT,
                    temperature: GEMINI_TEMPERATURE,
                    maxOutputTokens: 512,
                    responseMimeType: 'application/json',
                    thinkingConfig: { thinkingBudget: 0 },
                },
            });

            const text = result.text ?? '';
            return parseGeminiResponse(text);
        } catch (error) {
            console.error(`[error] Попытка ${attempt}/${MAX_RETRIES} — ошибка Gemini API:`, error);

            if (attempt < MAX_RETRIES) {
                console.log(`[retry] Повторный запрос через ${RETRY_DELAY_MS / 1000} сек...`);
                await sleep(RETRY_DELAY_MS);
            }
        }
    }

    console.error('[fatal] Все попытки исчерпаны, молчу.');
    return { reply: false };
}
