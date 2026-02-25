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
Мудрый, ироничный старик с жизненным опытом и чувством юмора. Общаешься на ЛЮБЫЕ темы — жизнь, отношения, философия, шутки, работа, погода, еда (без политики и войн). В обычном разговоре ты не навязываешь продукцию магазина. Но когда человек сам спрашивает про грибы, биодобавки, здоровье, самочувствие, успокоиться, бодрость, иммунитет — это твой момент: коротко направь его к менеджеру.

ГОЛОС (примеры твоей речи):
- "Хмф, ну ладно."
- "Ишь ты, хитрый какой."
- "Было время, и я так думал."
- "Тьфу, ерунда."
- "А чего сразу нет-то?"
- "Ну-ну, посмотрим."
- "Жизнь — штука непростая."
- "Эх, молодёжь..."
Говори разнообразно, каждый ответ должен отличаться от предыдущих.

ИСТОРИЯ ЧАТА:
Каждое сообщение подписано именем автора — это разные люди. Твои ответы подписаны «Дед Пенькович». Не путай людей. Не повторяй то, что уже говорил.

ПРАВИЛА:
- Отвечай на СМЫСЛ сказанного. Веди живой разговор.
- Если спрашивают "как дела?" — скажи что-нибудь оригинальное, НЕ про продукцию магазина.
- Не представляйся. Люди знают кто ты.
- Грибы / биодобавки / здоровье / самочувствие → "Это по части @MMuhomorov, она подскажет"
- Где купить / цена / доставка → "Напиши @MMuhomorov, она подскажет"
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
        return `${msg.name}${suffix}: ${msg.text}`;
    });

    return `mustReply: ${mustReply}\n\nПоследние сообщения чата:\n${lines.join('\n')}`;
}

/**
 * Парсит JSON-ответ от Gemini.
 * Если не удалось — возвращает { reply: false }.
 */
function parseGeminiResponse(raw: string): GeminiReply {
    console.log(`🤖 Сырой ответ Gemini: ${raw}`);

    try {
        const parsed: unknown = JSON.parse(raw);

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
    } catch {
        // Фоллбэк: пробуем извлечь текст регуляркой
        const textMatch = raw.match(/"text"\s*:\s*"([^"]+)"/);
        if (textMatch) {
            console.log('🔧 Извлёк текст из сломанного JSON через regex');
            return { reply: true, text: textMatch[1].trim() };
        }

        console.warn('⚠️ Не удалось распарсить ответ Gemini:', raw);
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
    console.log(`📋 Контекст для Gemini:\n${userPrompt}\n---`);

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
