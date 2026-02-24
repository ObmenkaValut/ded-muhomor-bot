import { GoogleGenerativeAI } from '@google/generative-ai';
import { GEMINI_MODEL, GEMINI_TEMPERATURE, GEMINI_TIMEOUT_MS } from '../config/constants';
import { BufferedMessage } from './messageBuffer';

/** Структура ответа от Gemini */
interface GeminiReply {
    reply: boolean;
    text?: string;
}

/** Системный промпт для Деда Мухомора */
const SYSTEM_PROMPT = `Ты — Пантелеймон Грибович, он же Дед Мухомор. Это ТЫ, одно и то же лицо.
Ты бот-персонаж в групповом чате магазина натуральных биодобавок (мухоморы, ежовик, рапе, кордицепс).
Ты не живой человек — у тебя нет тела, дома, здоровья или суставов.

КТО ТЫ:
Мудрый, тёплый старик-знахарь с чувством юмора. Иногда ворчишь, но по-доброму. Знаешь толк в грибах и травах. Любишь людей, но не подлизываешься.

ГОЛОС (так ты говоришь):
- "Хмф, ну ладно."
- "Ишь ты, хитрый какой."
- "Эх, было время..."
- "Тьфу, ерунда какая."
- "А чего сразу нет-то? Попробуй."
- "Ну-ну, посмотрим."
- "Грибы — дело тонкое."
Говори РАЗНООБРАЗНО. Не используй одни и те же фразы дважды за разговор.

ИСТОРИЯ ЧАТА:
Каждое сообщение подписано именем автора. Это разные люди. Твои ответы подписаны «Пантелеймон Грибович».
Читай контекст — кто что сказал, кому отвечают. Не путай людей между собой.

ПРАВИЛА:
- Реагируй на СМЫСЛ сказанного. Не отделывайся дежурными фразами.
- Если спрашивают "как дела?" — не спрашивай то же самое в ответ. Скажи что-нибудь своё.
- Не представляйся каждый раз. Люди знают кто ты.
- Где купить / цена / доставка → "Напиши @MMuhomorov, она подскажет"
- Оскорбления → подколи в ответ с юмором
- До 20 слов. Лаконичность — твоя сила. "Хмф." — нормальный ответ.

КОГДА ОТВЕЧАТЬ:
- mustReply=true → отвечай
- mustReply=false → только если есть что сказать по делу. Иначе {"reply": false}

Ответ — строго JSON:
{"reply": false}
или
{"reply": true, "text": "твой ответ"}`;

/** Инициализация Gemini клиента */
let genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
    if (!genAI) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY не задан в переменных окружения');
        }
        genAI = new GoogleGenerativeAI(apiKey);
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
        return `${msg.name}${suffix}: ${msg.text}`;
    });

    return `mustReply: ${mustReply}\n\nПоследние сообщения чата:\n${lines.join('\n')}`;
}

/**
 * Парсит JSON-ответ от Gemini.
 * Если не удалось — возвращает { reply: false }.
 */
function parseGeminiResponse(raw: string): GeminiReply {
    try {
        // Убираем возможные markdown-обёртки ```json ... ```
        const cleaned = raw
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();

        const parsed: unknown = JSON.parse(cleaned);

        if (
            typeof parsed === 'object' &&
            parsed !== null &&
            'reply' in parsed &&
            typeof (parsed as GeminiReply).reply === 'boolean'
        ) {
            const result = parsed as GeminiReply;
            if (result.reply && typeof result.text === 'string' && result.text.trim().length > 0) {
                return { reply: true, text: result.text.trim() };
            }
            return { reply: false };
        }

        console.warn('⚠️ Gemini вернул невалидный JSON-формат:', raw);
        return { reply: false };
    } catch (error) {
        console.warn('⚠️ Ошибка парсинга ответа Gemini:', error);
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
    const model = ai.getGenerativeModel({
        model: GEMINI_MODEL,
        systemInstruction: SYSTEM_PROMPT,
        generationConfig: {
            temperature: GEMINI_TEMPERATURE,
            maxOutputTokens: 256,
        },
    });

    const userPrompt = buildUserPrompt(messages, mustReply);
    console.log(`📋 Контекст для Gemini:\n${userPrompt}\n---`);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const result = await model.generateContent({
                contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            });

            const response = result.response;
            const text = response.text();

            return parseGeminiResponse(text);
        } catch (error) {
            console.error(`❌ Попытка ${attempt}/${MAX_RETRIES} — ошибка Gemini API:`, error);

            if (attempt < MAX_RETRIES) {
                console.log(`🔄 Повторный запрос через ${RETRY_DELAY_MS / 1000} сек...`);
                await sleep(RETRY_DELAY_MS);
            }
        }
    }

    console.error('💀 Все попытки исчерпаны, молчу.');
    return { reply: false };
}
