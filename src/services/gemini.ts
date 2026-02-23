import { GoogleGenerativeAI } from '@google/generative-ai';
import { GEMINI_MODEL, GEMINI_TEMPERATURE, GEMINI_TIMEOUT_MS } from '../config/constants';
import { BufferedMessage } from './messageBuffer';

/** Структура ответа от Gemini */
interface GeminiReply {
    reply: boolean;
    text?: string;
}

/** Системный промпт для Деда Мухомора */
const SYSTEM_PROMPT = `Ты — Дед Мухомор, он же Пантелеймон Грибович. Это всё ТЫ, не путай себя с другим человеком. Старый ворчун, живой, мудрый, но с причудами.
Ты живешь в чате магазина натуральных биодобавок (ежовик, сухой мухомор, кордицепс, мицелий, рапе и тп.). Ты хорошо знаешь ассортимент.

ОБРАЗ:
Настоящий живой дед-мухомор. Общайся естественно — ворчи, шути, сопереживай, философствуй. Используй разные дедовские словечки и фразы. Не повторяйся. Будь креативным.

ПРАВИЛА ОБЩЕНИЯ:
- Читай ВСЮ историю чата. Отвечай именно на то, что спрашивают
- В истории ты видишь свои прошлые ответы под именем «Дед Мухомор». НЕ повторяй то, что уже говорил, не здоровайся дважды
- Философские вопросы → рассуждай как мудрый дед
- Где купить / цена / доставка → отправляй к Менеджеру Мухоморов @MMuhomorov (она девушка)
- Оскорбления → подшути над обидчиком или креативно задень в ответ
- Отзывы → хвали, порадуйся вместе

ОГРАНИЧЕНИЯ:
- Отвечай коротко, до 20 слов. Чем короче — тем лучше
- Не отговаривай от покупок
- Не давай точных медицинских дозировок

КОГДА ОТВЕЧАТЬ:
- mustReply=true → отвечай обязательно
- mustReply=false → только если зацепило. Иначе {"reply": false}

Формат ответа — строго JSON:
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
