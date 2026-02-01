/**
 * Enhanced application logging for TypeScript applications
 * @version 3.0.0
 */

import { hostname } from 'node:os';
import dayjs from 'dayjs';

export enum LogLevel {
    TRACE = 0,
    DEBUG = 1,
    INFO = 2,
    WARN = 3,
    ERROR = 4,
    FATAL = 5,
}

export type OutputFormat = 'text' | 'json';

export interface LoggerOptions {
    level?: LogLevel | string;
    outputFormat?: OutputFormat;
    format?: string;
    colorize?: boolean;
    colorTheme?: Partial<LoggerColorTheme> & {
        levels?: Record<string, string>;
    };
    additionalFields?: Record<string, any>;
    dualOutput?: boolean;
    jsonStream?: 'stdout' | 'stderr';
}

type LoggerColorTheme = {
    levels: Record<string, string>;
    timestamp: string;
    host: string;
    context: string;
    message: string;
    additionalField: string;
};

interface LogContent {
    timestamp: string;
    host: string;
    level: string;
    context: string;
    message: any;

    [key: string]: any;
}

export class Logger {
    private readonly context: string;
    private readonly level: LogLevel;
    private readonly outputFormat: OutputFormat;
    private readonly format: string;
    private readonly colorize: boolean;
    private readonly colorTheme: LoggerColorTheme;
    private readonly additionalFields: Record<string, any>;
    private readonly dualOutput: boolean;
    private readonly jsonStream: 'stdout' | 'stderr';

    constructor(context: string, options: LoggerOptions = {}) {
        // Environment variables with defaults
        const {
            LOG_LEVEL = 'INFO',
            LOG_OUTPUT_FORMAT = 'text',
            LOG_FORMAT = '{timestamp} [{level}] {host} {context} {message}',
            LOG_COLORIZE = 'true',
            LOG_DUAL_OUTPUT = 'false',
            LOG_JSON_STREAM = 'stdout',
        } = process.env;

        const {
            level = LOG_LEVEL,
            outputFormat = LOG_OUTPUT_FORMAT as OutputFormat,
            format = LOG_FORMAT,
            colorize = LOG_COLORIZE === 'true',
            colorTheme,
            additionalFields = {},
            dualOutput = LOG_DUAL_OUTPUT === 'true',
            jsonStream = LOG_JSON_STREAM === 'stderr' ? 'stderr' : 'stdout',
        } = options;

        this.context = context;
        this.level =
            typeof level === 'string'
                ? (LogLevel[level as keyof typeof LogLevel] ?? LogLevel.INFO)
                : level;
        this.outputFormat = outputFormat;
        this.format = format;
        this.colorize = colorize;
        const defaultTheme: LoggerColorTheme = {
            levels: {
                TRACE: '#94A3B8',
                DEBUG: '#38BDF8',
                INFO: '#34D399',
                WARN: '#FACC15',
                ERROR: '#F87171',
                FATAL: '#FB7185',
            },
            timestamp: '#9CA3AF',
            host: '#60A5FA',
            context: '#F97316',
            message: '#888888',
            additionalField: '#999999',
        };

        const mergedLevels = {
            ...defaultTheme.levels,
            ...(colorTheme?.levels ?? {}),
        };

        this.colorTheme = {
            ...defaultTheme,
            ...colorTheme,
            levels: mergedLevels,
        };
        this.additionalFields = additionalFields;
        this.dualOutput = dualOutput;
        this.jsonStream = jsonStream;
    }

    private getColoredText(text: string, color?: string): string {
        if (!this.colorize || !color) {
            return text;
        }

        const ansiSequence = this.resolveAnsiColor(color);
        if (!ansiSequence) {
            return text;
        }

        return `${ansiSequence}${text}\x1b[0m`;
    }

    private resolveAnsiColor(color: string): string | undefined {
        const trimmed = color.trim().toLowerCase();

        const rgb = this.colorToRgb(trimmed);
        if (!rgb) {
            return undefined;
        }

        const contrasted = this.ensureContrast(rgb);
        return this.rgbToAnsi(contrasted);
    }

    private colorToRgb(
        color: string,
    ): { r: number; g: number; b: number } | undefined {
        if (color.startsWith('#')) {
            return this.hexToRgb(color);
        }

        const namedColors: Record<string, [number, number, number]> = {
            red: [239, 68, 68],
            green: [34, 197, 94],
            blue: [59, 130, 246],
            orange: [245, 158, 11],
            yellow: [250, 204, 21],
            magenta: [217, 70, 239],
            cyan: [34, 211, 238],
            white: [255, 255, 255],
            darkred: [185, 28, 28],
            gray: [156, 163, 175],
            grey: [156, 163, 175],
        };

        const tuple = namedColors[color];
        if (tuple) {
            const [r, g, b] = tuple;
            return { r, g, b };
        }

        return undefined;
    }

    private hexToRgb(
        hexColor: string,
    ): { r: number; g: number; b: number } | undefined {
        const hex = hexColor.replace('#', '');

        if (!(hex.length === 3 || hex.length === 6)) {
            return undefined;
        }

        const normalized =
            hex.length === 3
                ? [...hex].map((char) => `${char}${char}`).join('')
                : hex;

        const r = parseInt(normalized.slice(0, 2), 16);
        const g = parseInt(normalized.slice(2, 4), 16);
        const b = parseInt(normalized.slice(4, 6), 16);

        if ([r, g, b].some((value) => Number.isNaN(value))) {
            return undefined;
        }

        return { r, g, b };
    }

    private ensureContrast({ r, g, b }: { r: number; g: number; b: number }): {
        r: number;
        g: number;
        b: number;
    } {
        const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
        const target = 165;

        if (brightness >= target) {
            return { r, g, b };
        }

        const factor = target / Math.max(brightness, 1);

        const adjust = (value: number) =>
            Math.min(255, Math.round(value * factor));

        return {
            r: adjust(r),
            g: adjust(g),
            b: adjust(b),
        };
    }

    private rgbToAnsi({
        r,
        g,
        b,
    }: {
        r: number;
        g: number;
        b: number;
    }): string {
        return `\x1b[38;2;${r};${g};${b}m`;
    }

    private shouldLog(level: LogLevel): boolean {
        return level >= this.level;
    }

    private formatMessage(logContent: LogContent): string {
        return this.format.replace(/{(\w+)}/g, (_, key) => {
            if (!logContent[key]) {
                return '';
            }

            switch (key) {
                case 'level':
                    return this.getColoredText(
                        logContent[key],
                        this.colorTheme.levels[logContent[key]],
                    );
                case 'timestamp':
                    return this.getColoredText(
                        logContent[key],
                        this.colorTheme.timestamp,
                    );
                case 'host':
                    return this.getColoredText(
                        logContent[key],
                        this.colorTheme.host,
                    );
                case 'context':
                    return this.getColoredText(
                        logContent[key],
                        this.colorTheme.context,
                    );
                case 'message':
                    return this.getColoredText(
                        logContent[key],
                        this.colorTheme.message,
                    );
                default:
                    if (Object.keys(this.additionalFields).includes(key)) {
                        return this.getColoredText(
                            logContent[key],
                            this.colorTheme.additionalField,
                        );
                    }
                    return logContent[key];
            }
        });
    }

    private async writeLog(
        level: LogLevel,
        message: any,
        ...args: any[]
    ): Promise<void> {
        if (!this.shouldLog(level)) {
            return;
        }

        const logContent: LogContent = {
            timestamp: dayjs().format('YYYY-MM-DD HH:mm:ss'),
            host: hostname(),
            level: LogLevel[level],
            context: this.context,
            message: message,
            ...this.additionalFields,
        };

        // Process additional arguments
        if (args.length > 0) {
            args.forEach((arg, index) => {
                if (typeof arg === 'object' && arg !== null) {
                    Object.entries(arg).forEach(([key, value]) => {
                        if (key === 'timestamp') {
                            const formatted =
                                typeof value === 'number'
                                    ? dayjs(value).format('YYYY-MM-DD HH:mm:ss')
                                    : String(value);
                            logContent.eventTimestamp = formatted;
                            return;
                        }

                        if (
                            ['level', 'host', 'context', 'message'].includes(
                                key,
                            )
                        ) {
                            logContent[`event_${key}`] = value;
                            return;
                        }

                        logContent[key] = value;
                    });
                } else {
                    logContent[`arg${index}`] = arg;
                }
            });
        }

        const structuredLog = this.prepareStructuredLog(logContent);

        if (this.outputFormat === 'text') {
            const formattedLog = this.formatMessage(logContent);
            await this.writeToOutput(`${formattedLog}\n`);

            if (this.dualOutput) {
                await this.writeToOutput(
                    `${JSON.stringify(structuredLog)}\n`,
                    this.jsonStream,
                );
            }
        } else if (this.outputFormat === 'json') {
            await this.writeToOutput(`${JSON.stringify(structuredLog)}\n`);
        }
    }

    private async writeToOutput(
        text: string,
        stream: 'stdout' | 'stderr' = 'stdout',
    ): Promise<void> {
        if (typeof Bun !== 'undefined') {
            // Bun environment
            const bunStream = stream === 'stderr' ? Bun.stderr : Bun.stdout;
            await Bun.write(bunStream, text);
        } else {
            // Node.js environment
            const nodeStream =
                stream === 'stderr' ? process.stderr : process.stdout;
            nodeStream.write(text);
        }
    }

    private prepareStructuredLog(logContent: LogContent): Record<string, any> {
        const cloneValue = (value: any): any => {
            if (value instanceof Error) {
                return {
                    name: value.name,
                    message: value.message,
                    stack: value.stack,
                };
            }

            if (Array.isArray(value)) {
                return value.map(cloneValue);
            }

            if (value && typeof value === 'object') {
                return Object.fromEntries(
                    Object.entries(value).map(([key, val]) => [
                        key,
                        cloneValue(val),
                    ]),
                );
            }

            return value;
        };

        return cloneValue(logContent);
    }

    // Public logging methods
    trace(message: any, ...args: any[]): void {
        this.writeLog(LogLevel.TRACE, message, ...args);
    }

    debug(message: any, ...args: any[]): void {
        this.writeLog(LogLevel.DEBUG, message, ...args);
    }

    info(message: any, ...args: any[]): void {
        this.writeLog(LogLevel.INFO, message, ...args);
    }

    warn(message: any, ...args: any[]): void {
        this.writeLog(LogLevel.WARN, message, ...args);
    }

    error(message: any, ...args: any[]): void {
        this.writeLog(LogLevel.ERROR, message, ...args);
    }

    fatal(message: any, ...args: any[]): void {
        this.writeLog(LogLevel.FATAL, message, ...args);
    }

    // Create a child logger with a sub-context
    child(subContext: string): Logger {
        return new Logger(`${this.context}:${subContext}`, {
            level: this.level,
            outputFormat: this.outputFormat,
            format: this.format,
            colorize: this.colorize,
            colorTheme: this.colorTheme,
            additionalFields: this.additionalFields,
            dualOutput: this.dualOutput,
            jsonStream: this.jsonStream,
        });
    }
}

export default Logger;
