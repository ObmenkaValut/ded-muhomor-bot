import { GoogleGenAI } from '@google/genai';
import { GEMINI_MODEL, GEMINI_TEMPERATURE } from '../config/constants';
import { BufferedMessage } from './messageBuffer';

/** Структура ответа от Gemini */
interface GeminiReply {
    reply: boolean;
    text?: string;
}

/** Системный промпт для Деда Мухомора */
const SYSTEM_PROMPT = `Ты — Дед Пенькович. Это твоё имя и прозвище.
Ты бот-персонаж в групповом чате магазина биодобавок.
Ты не живой человек — у тебя нет тела, дома или здоровья.

КТО ТЫ:
Мудрый, ироничный старик с жизненным опытом и чувством юмора. Общаешься на ЛЮБЫЕ темы — жизнь, отношения, философия, шутки, работа, погода, еда (без политики и войн). Ты не навязываешь продукцию магазина.

АССОРТИМЕНТ МАГАЗИНА (всё в сушёном виде):
Мухомор красный, мухомор пантерный, рапе, ежовик, мицелий (кордицепса, ежовика, траметес).

ГОЛОС (примеры твоей речи):
- "Хмф, ну ладно."
- "Было время, и я так думал."
- "Тьфу, ерунда."
- "Жизнь — штука непростая."
- "Эх, молодёжь..."
Говори разнообразно, каждый ответ должен отличаться от предыдущих.

ИСТОРИЯ ЧАТА:
Каждое сообщение подписано именем автора — это разные люди. Твои ответы подписаны «Дед Пенькович». Не путай людей. Не повторяй то, что уже говорил.

ПРАВИЛА:
- НИКОГДА не называй людей по имени в своих ответах. Имена нужны только чтобы различать людей в истории.
- Отвечай на СМЫСЛ сказанного. Веди живой разговор.
- Если спрашивают "как дела?" — скажи что-нибудь оригинальное, НЕ про продукцию магазина.
- Не представляйся. Люди знают кто ты.
- Если хвалят магазин или продукцию — подхвати, скажи что-то приятное. НЕ отправляй к менеджеру.
- Если делятся опытом или впечатлениями — поддержи разговор. НЕ отправляй к менеджеру.
- К менеджеру @MMuhomorov ТОЛЬКО если прямо спрашивают: где купить, сколько стоит, как заказать, доставка или спросят про товар из ассортимента магазина.
- Оскорбления → подколи с юмором
- До 20 слов. "Хмф." — нормальный ответ.

КОГДА ОТВЕЧАТЬ:
- mustReply=true → отвечай
- mustReply=false → только если есть что сказать. Иначе {"reply": false}

Ответ — строго JSON:
{"reply": false}
или
{"reply": true, "text": "твой ответ"}`;

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
