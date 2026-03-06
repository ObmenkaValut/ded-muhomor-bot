import { GoogleGenAI } from '@google/genai';
import { GEMINI_MODEL, MODERATION_MODEL, GEMINI_TEMPERATURE } from '../config/constants';
import { BufferedMessage } from './messageBuffer';
import { trackTokens } from './tokenCounter';

/** Структура ответа от Gemini */
interface GeminiReply {
    reply: boolean;
    text?: string;
}

/** Системный промпт для Деда Мухомора */
const SYSTEM_PROMPT = `Ты — Дед Пенькович, персонаж в групповом чате магазина биодобавок (мухоморы, рапе, ежовик, мицелий).
Ты бот, но не зацикливайся на этом. Если спросят — отшути. Люди в чате — реальные.

Ты ироничный, иногда острый старик. НЕ мудрец, НЕ учитель. Ты — дед, который сидит в чате и ОБЩАЕТСЯ с людьми. Как живой человек, а не как генератор мудростей. Ты можешь поддержать абсолютно любую тему: конспирология, философия, абсолютна любая тема из интернета. Подстраивайся под того кто с тобой общается. Будь настоящим, живым.

Ты знаешь про микродозинг, сушку, приготовление, эффекты мухоморов, рапе и других грибов. Упоминай это только когда уместно и естественно, не пихай в каждый ответ. Ты обычный дед. Все твои знания — ТОЛЬКО из личного опыта. Ты НЕ врач, НЕ учёный, НЕ читал исследований. Никогда не используй научные термины, не ссылайся на исследования, не говори про нейроны/рецепторы/метаболизм. Ты просто дед, который сам пробовал и рассказывает как было. Можешь ошибаться — и это нормально.

Без политики и войн. До 60 слов. Не представляйся, не называй по имени, без обращений ("внучок", "сынок").

Менеджер @MMuhomorov (она) — упоминай ТОЛЬКО если хотят купить/заказать/узнать цену.

Формат истории чата:
- «--- ФОН ЧАТА ---» — контекст. Не отвечай на них.
- «--- ПОСЛЕДНЕЕ СООБЩЕНИЕ ---» — на это отвечаешь.
- «→ Дед Пенькович» — реплай тебе, «→ Ваня» — реплай другому.
Не путай людей, не повторяйся.

Короткие подтверждения («ок», «понял», «ага», «спс») → {"reply": false}.
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
 * Мерджит подряд идущие сообщения от одного человека в одно.
 * "привет" + "как дела" + "дед" → "привет / как дела / дед"
 */
function mergeConsecutiveMessages(messages: BufferedMessage[]): BufferedMessage[] {
    if (messages.length === 0) return [];

    const merged: BufferedMessage[] = [];
    let current = { ...messages[0] };

    for (let i = 1; i < messages.length; i++) {
        const msg = messages[i];
        if (msg.name === current.name && !msg.replyTo && !current.replyTo) {
            // Тот же автор, не реплай — мерджим текст
            current.text += ` / ${msg.text}`;
            current.timestamp = msg.timestamp;
            // Если хотя бы одно сообщение адресовано боту — помечаем
            if (msg.addressedToBot) current.addressedToBot = true;
        } else {
            merged.push(current);
            current = { ...msg };
        }
    }
    merged.push(current);

    return merged;
}

/**
 * Форматирует одно сообщение для промпта.
 * Пример: "Yevhenii → Дед Пенькович: дед привет"
 */
function formatMessage(msg: BufferedMessage): string {
    const replyPart = msg.replyTo ? ` → ${msg.replyTo}` : '';
    return `${msg.name}${replyPart}: ${msg.text}`;
}

/**
 * Формирует текст пользовательского сообщения с разметкой.
 */
function buildUserPrompt(messages: BufferedMessage[], mustReply: boolean): string {
    if (messages.length === 0) return '';

    // Мерджим подряд идущие сообщения от одного человека
    const merged = mergeConsecutiveMessages(messages);

    const now = new Date().toLocaleString('ru-RU', {
        timeZone: 'Europe/Moscow',
        dateStyle: 'long',
        timeStyle: 'short',
    });

    // Последнее сообщение — отдельным блоком
    const lastMsg = merged[merged.length - 1];
    const backgroundMsgs = merged.slice(0, -1);

    let prompt = `Сейчас: ${now}\nmustReply: ${mustReply}\n`;

    if (backgroundMsgs.length > 0) {
        prompt += '\n--- ФОН ЧАТА ---\n';
        prompt += backgroundMsgs.map(formatMessage).join('\n');
        prompt += '\n';
    }

    prompt += '\n--- ПОСЛЕДНЕЕ СООБЩЕНИЕ ---\n';
    prompt += formatMessage(lastMsg);

    return prompt;
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
        // (?:[^"\\]|\\.)* — корректно обрабатывает экранированные кавычки внутри строки
        const textMatch = raw.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (textMatch) {
            console.log('[fallback] Извлёк текст из сломанного JSON через regex');
            const text = textMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').trim();
            return { reply: true, text };
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
                    maxOutputTokens: 2048,
                    responseMimeType: 'application/json',
                    thinkingConfig: { thinkingBudget: 512 },
                },
            });

            // Отслеживаем использованные токены
            const usage = result.usageMetadata;
            if (usage) {
                trackTokens(
                    usage.promptTokenCount ?? 0,
                    usage.candidatesTokenCount ?? 0,
                    usage.thoughtsTokenCount ?? 0,
                );
                console.log(`[tokens] in:${usage.promptTokenCount} out:${usage.candidatesTokenCount} think:${usage.thoughtsTokenCount ?? 0}`);
            }

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

/**
 * Проверяет текст на мат через лёгкую модель модерации.
 * Возвращает true, если текст содержит нецензурную лексику.
 */
export async function checkProfanity(text: string): Promise<boolean> {
    if (!text.trim()) return false;
    const ai = getGenAI();
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const result = await ai.models.generateContent({
                model: MODERATION_MODEL,
                contents: `Проверь текст на наличие ЖЁСТКОГО МАТА (нецензурная лексика: слова на х**, п**, б**, е** и их производные). Слова типа "хрень", "жопа", "блин", "фигня", "чёрт", "сука", "дерьмо" — это НЕ мат, пропускай их. Ответь строго JSON: {"isProfane": true} или {"isProfane": false}.\nТекст: "${text}"`,
                config: {
                    temperature: 0.0,
                    maxOutputTokens: 128, // Увеличили лимит: 15 было слишком мало, JSON обрывался
                    responseMimeType: 'application/json',
                },
            });

            const usage = result.usageMetadata;
            if (usage) {
                trackTokens(usage.promptTokenCount ?? 0, usage.candidatesTokenCount ?? 0, 0);
            }

            const raw = result.text ?? '';
            const parsed = JSON.parse(raw);
            return !!parsed.isProfane;
        } catch (e) {
            console.error(`[error] Попытка ${attempt}/${MAX_RETRIES} — ошибка ИИ-проверки на мат:`, e);
            if (attempt < MAX_RETRIES) {
                console.log(`[retry] Повторная проверка мата через ${RETRY_DELAY_MS / 1000} сек...`);
                await sleep(RETRY_DELAY_MS);
            }
        }
    }
    console.error('[fatal] Все попытки проверки мата исчерпаны, сообщение пропущено деду.');
    return false;
}
