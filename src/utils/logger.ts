/**
 * Enhanced application logging for TypeScript applications
 * @version 3.0.0
 */

import { hostname } from 'node:os';
import dayjs from 'dayjs';
import { colorizeText } from './logColors';

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
        return colorizeText(text, color, this.colorize);
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

        this.mergeArgs(logContent, args);

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
        const bunStream = stream === 'stderr' ? Bun.stderr : Bun.stdout;
        await Bun.write(bunStream, text);
    }

    /** Field names reserved by the base log content; collisions are namespaced */
    private static readonly RESERVED_FIELDS = [
        'level',
        'host',
        'context',
        'message',
    ];

    /** Fold extra log arguments into the structured log content */
    private mergeArgs(logContent: LogContent, args: any[]): void {
        args.forEach((arg, index) => {
            if (typeof arg === 'object' && arg !== null) {
                this.mergeObjectArg(logContent, arg);
            } else {
                logContent[`arg${index}`] = arg;
            }
        });
    }

    /** Merge a single object argument, namespacing reserved keys */
    private mergeObjectArg(
        logContent: LogContent,
        arg: Record<string, unknown>,
    ): void {
        for (const [key, value] of Object.entries(arg)) {
            if (key === 'timestamp') {
                logContent.eventTimestamp =
                    typeof value === 'number'
                        ? dayjs(value).format('YYYY-MM-DD HH:mm:ss')
                        : String(value);
            } else if (Logger.RESERVED_FIELDS.includes(key)) {
                logContent[`event_${key}`] = value;
            } else {
                logContent[key] = value;
            }
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
