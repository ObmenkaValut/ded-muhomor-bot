/**
 * Быстрый префильтр мата без обращения к API.
 *
 * Специально ЛИБЕРАЛЬНЫЙ: лишнее срабатывание стоит одного запроса к модели
 * модерации, а пропуск — неудалённое оскорбление. Решение «оскорбление или нет»
 * принимает checkInsult(), сюда попадает только вопрос «есть ли вообще мат».
 */

/** Латинские/цифровые двойники кириллических букв */
const LOOKALIKES: Record<string, string> = {
    a: 'а', b: 'б', c: 'с', e: 'е', h: 'н', i: 'і', k: 'к', m: 'м',
    o: 'о', p: 'р', t: 'т', x: 'х', y: 'у',
    '6': 'б', '3': 'з', '0': 'о',
    ё: 'е',
};

/** Символы, которыми маскируют букву: х*й, бл@ть */
const MASK_CHARS = /[*#@%$]/g;

/** Разделители внутри слова: б.л.я.т.ь, х-у-й */
const INNER_SEPARATORS = /(?<=\p{L})[._\-]+(?=\p{L})/gu;

/** Чем пробуем заменить маску (самые частые скрытые буквы) */
const MASK_GUESSES = ['', 'у', 'и', 'я', 'б', 'е'];

/** Приставки перед корнем «еб/ёб/йоб/їб» */
const EB_PREFIXES = [
    'за', 'на', 'по', 'у', 'вы', 'ви', 'от', 'отъ', 'вид', 'від', 'до', 'раз', 'разъ', 'роз',
    'съ', 'изъ', 'из', 'про', 'при', 'под', 'подъ', 'під', 'пере', 'недо', 'не', 'долбо',
    "з'", 'з’', 'зʼ', 'зъ', 'въ', 'объ',
].join('|');

const OBSCENE_PATTERNS: RegExp[] = [
    // хуй, нахуй, похуй, хуйня, охуенно, хуёвый
    /ху[йяеиюї]/u,
    // пизда, пиздец, п*здец (→ пздец), пиздабол
    /п[иіы]?зд/u,
    // блядь, блять, бля — только в начале слова (не «оскорблять», «употреблять»)
    /(?<!\p{L})бля/u,
    // ебать, заебал, уёбок, уйобок, йобаний, їбати, долбоёб — только в начале слова или после приставки
    new RegExp(`(?<!\\p{L})(?:${EB_PREFIXES})?(?:е|йо|йе|ї|є|ъе|ьо)б`, 'u'),
    // манда — только целым словом (не «команда», «мандарин»)
    /(?<!\p{L})манд(?:а|у|е|ой|ы)?(?!\p{L})/u,
    /залуп/u,
    /муд[оа]звон/u,
    /п[иі]д[оа]р|п[иі]др/u,
];

/** Склеивает идущие подряд одиночные буквы: «х у й тебе» → «хуй тебе» */
function joinSpacedLetters(text: string): string {
    const tokens = text.split(/\s+/);
    const result: string[] = [];
    let run = '';

    for (const token of tokens) {
        if (/^\p{L}$/u.test(token)) {
            run += token;
            continue;
        }
        if (run) {
            result.push(run);
            run = '';
        }
        result.push(token);
    }
    if (run) result.push(run);

    return result.join(' ');
}

/** Приводит текст к нижнему регистру и кириллице, убирает разделители внутри слов */
function normalize(text: string): string {
    const lower = text.toLowerCase();
    const mapped = Array.from(lower, (ch) => LOOKALIKES[ch] ?? ch).join('');
    return joinSpacedLetters(mapped.replace(INNER_SEPARATORS, ''));
}

/** Есть ли в тексте корень мата (включая замаскированные написания) */
export function containsObsceneRoot(text: string): boolean {
    if (!text.trim()) return false;

    const normalized = normalize(text);
    return MASK_GUESSES.some((guess) => {
        const variant = normalized.replace(MASK_CHARS, guess);
        return OBSCENE_PATTERNS.some((pattern) => pattern.test(variant));
    });
}
