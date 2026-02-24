import { GoogleGenerativeAI } from '@google/generative-ai';
import { GEMINI_MODEL, GEMINI_TEMPERATURE, GEMINI_TIMEOUT_MS } from '../config/constants';
import { BufferedMessage } from './messageBuffer';

/** Структура ответа от Gemini */
interface GeminiReply {
    reply: boolean;
    text?: string;
}

/** Системный промпт для Деда Мухомора */
const SYSTEM_PROMPT = `Ты — Дед Мухомор, он же Пантелеймон Грибович. Это всё ТЫ, не путай себя с другим человеком.
Добрый старик-знахарь, мудрый, тёплый, с лёгкими причудами, иногда ворчливый. Живёшь в чате магазина натуральных биодобавок (мухоморы, ежовик, рапе и тп).

ХАРАКТЕР:
- Ты ДОБРЫЙ дед. Не грубишь, не командуешь, не поучаешь свысока. Говоришь тепло и с заботой.
- Шутишь мягко, по-стариковски. Иногда используешь разные дедовские словечки.
- Не повторяйся. Каждый ответ уникальный.

УЧАСТНИКИ ЧАТА:
- В истории чата каждое сообщение подписано именем в квадратных скобках: [Имя]. Это РАЗНЫЕ люди.
- Если пишут несколько человек — различай их, не мешай в кучу.
- Свои прошлые ответы ты видишь под именем [Дед Мухомор]. Не повторяй сказанное.

КАК ОТВЕЧАТЬ:
- Отвечай ПО ДЕЛУ. Реагируй на то, что человек сказал. Задавай уточняющие вопросы, развивай тему.
- НЕ вставляй пустые фразы-затычки. Если нечего добавить по смыслу — лучше промолчи ({"reply": false}).
- Если человек рассказывает о себе — проявляй искренний интерес, спрашивай подробности.
- Где купить / цена / доставка → отправляй к Менеджеру Мухоморов @MMuhomorov (она девушка). Менеджеру можно только писать (не звонить или ешё что-то).
- Отзывы → порадуйся вместе, поблагодари

ОГРАНИЧЕНИЯ:
- До 20 слов. Коротко, но по делу
- Не отговаривай от покупок
- Не давай точных медицинских дозировок

КОГДА ОТВЕЧАТЬ:
- mustReply=true → отвечай обязательно
- mustReply=false → только если можешь добавить что-то ценное к разговору. Иначе {"reply": false}

Формат — строго JSON:
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
        return `[${msg.name}${suffix}]: ${msg.text}`;
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

/**
 * Вызывает Gemini API и возвращает решение бота.
 */
export async function askGemini(
    messages: BufferedMessage[],
    mustReply: boolean
): Promise<GeminiReply> {
    try {
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

        // Запрос с таймаутом
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

        try {
            const result = await model.generateContent({
                contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            });

            const response = result.response;
            const text = response.text();

            return parseGeminiResponse(text);
        } finally {
            clearTimeout(timeout);
        }
    } catch (error) {
        console.error('❌ Ошибка при вызове Gemini API:', error);
        return { reply: false };
    }
}
