/** Счётчик использования токенов Gemini API */

interface TokenUsage {
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
}

const dailyUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 };
const monthlyUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 };

/** Стоимость gemini-2.5-flash с thinking (USD за 1M токенов) */
const PRICE = {
    input: 0.15,
    output: 3.50,
    thinking: 3.50,
};

function calcCost(usage: TokenUsage): number {
    return (usage.inputTokens / 1_000_000) * PRICE.input
        + (usage.outputTokens / 1_000_000) * PRICE.output
        + (usage.thinkingTokens / 1_000_000) * PRICE.thinking;
}

function formatReport(label: string, usage: TokenUsage): string {
    const cost = calcCost(usage);
    return `[report] ${label}: in=${usage.inputTokens} out=${usage.outputTokens} think=${usage.thinkingTokens} ~$${cost.toFixed(4)}`;
}

/** Добавляет токены от одного запроса */
export function trackTokens(input: number, output: number, thinking: number): void {
    dailyUsage.inputTokens += input;
    dailyUsage.outputTokens += output;
    dailyUsage.thinkingTokens += thinking;

    monthlyUsage.inputTokens += input;
    monthlyUsage.outputTokens += output;
    monthlyUsage.thinkingTokens += thinking;
}

/** Логирует дневную и общую статистику, сбрасывает дневной счётчик */
export function logAndResetDaily(): void {
    console.log(formatReport('Сегодня потрачено', dailyUsage));
    console.log(formatReport('Всего потрачено', monthlyUsage));
    dailyUsage.inputTokens = 0;
    dailyUsage.outputTokens = 0;
    dailyUsage.thinkingTokens = 0;
}

/** Логирует и сбрасывает общий счётчик (вызывается в начале нового месяца) */
export function logAndResetMonthly(): void {
    console.log(formatReport('Итог за месяц', monthlyUsage));
    monthlyUsage.inputTokens = 0;
    monthlyUsage.outputTokens = 0;
    monthlyUsage.thinkingTokens = 0;
}
