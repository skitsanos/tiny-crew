/**
 * Enhanced application logging for TypeScript applications
 * @version 3.0.0
 */
import { hostname } from 'os';
import dayjs from 'dayjs';

export enum LogLevel {
    TRACE = 0,
    DEBUG = 1,
    INFO = 2,
    WARN = 3,
    ERROR = 4,
    FATAL = 5
}

export type OutputFormat = 'text' | 'json';

export interface LoggerOptions {
    level?: LogLevel | string;
    outputFormat?: OutputFormat;
    format?: string;
    colorize?: boolean;
    colorTheme?: {
        levels: Record<string, string>;
        timestamp?: string;
        host?: string;
        context?: string;
        message?: string;
        additionalField?: string;
    };
    additionalFields?: Record<string, any>;
}

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
    private readonly colorTheme: Required<LoggerOptions['colorTheme']>;
    private readonly additionalFields: Record<string, any>;

    constructor(context: string, options: LoggerOptions = {}) {
        // Environment variables with defaults
        const {
            LOG_LEVEL = 'INFO',
            LOG_OUTPUT_FORMAT = 'text',
            LOG_FORMAT = '{timestamp} [{level}] {host} {context} {message}',
            LOG_COLORIZE = 'true'
        } = process.env;

        const {
            level = LOG_LEVEL,
            outputFormat = LOG_OUTPUT_FORMAT as OutputFormat,
            format = LOG_FORMAT,
            colorize = LOG_COLORIZE === 'true',
            colorTheme = {
                levels: {
                    TRACE: '#999',
                    DEBUG: '#999',
                    INFO: 'green',
                    WARN: 'orange',
                    ERROR: 'red',
                    FATAL: 'darkred'
                },
                timestamp: '#888',
                host: '#aabbcc',
                context: '#99bbcc',
                message: '#222',
                additionalField: '#999'
            },
            additionalFields = {}
        } = options;

        this.context = context;
        this.level = LogLevel[level as keyof typeof LogLevel] ?? LogLevel.INFO;
        this.outputFormat = outputFormat;
        this.format = format;
        this.colorize = colorize;
        this.colorTheme = colorTheme as Required<LoggerOptions['colorTheme']>;
        this.additionalFields = additionalFields;
    }

    private getColoredText(text: string, color?: string): string {
        if (!this.colorize || !color) return text;

        // Support for Node.js and Bun environments
        if (typeof Bun !== 'undefined') {
            // @ts-ignore - Bun-specific API
            return `${Bun.color(color, 'ansi') + text}\x1b[0m`;
        } else {
            // Basic ANSI color support for Node.js
            const ansiColors: Record<string, string> = {
                'red': '\x1b[31m',
                'green': '\x1b[32m',
                'orange': '\x1b[33m',
                'blue': '\x1b[34m',
                'darkred': '\x1b[31m',
                '#999': '\x1b[90m',
                '#888': '\x1b[90m',
                '#aabbcc': '\x1b[36m',
                '#99bbcc': '\x1b[36m',
                '#222': '\x1b[37m'
            };
            return `${ansiColors[color] || ''}${text}\x1b[0m`;
        }
    }

    private shouldLog(level: LogLevel): boolean {
        return level >= this.level;
    }

    private formatMessage(logContent: LogContent): string {
        return this.format.replace(/{(\w+)}/g, (_, key) => {
            if (!logContent[key]) return '';

            switch (key) {
                case 'level':
                    return this.getColoredText(
                        logContent[key],
                        this.colorTheme?.levels[logContent[key]]
                    );
                case 'timestamp':
                    return this.getColoredText(logContent[key], this.colorTheme?.timestamp);
                case 'host':
                    return this.getColoredText(logContent[key], this.colorTheme?.host);
                case 'context':
                    return this.getColoredText(logContent[key], this.colorTheme?.context);
                case 'message':
                    return this.getColoredText(logContent[key], this.colorTheme?.message);
                default:
                    if (Object.keys(this.additionalFields).includes(key)) {
                        return this.getColoredText(logContent[key], this.colorTheme?.additionalField);
                    }
                    return logContent[key];
            }
        });
    }

    private async writeLog(level: LogLevel, message: any, ...args: any[]): Promise<void> {
        if (!this.shouldLog(level)) {
            return;
        }

        const logContent: LogContent = {
            timestamp: dayjs().format('YYYY-MM-DD HH:mm:ss'),
            host: hostname(),
            level: LogLevel[level],
            context: this.context,
            message: message,
            ...this.additionalFields
        };

        // Process additional arguments
        if (args.length > 0) {
            args.forEach((arg, index) => {
                if (typeof arg === 'object' && arg !== null) {
                    Object.entries(arg).forEach(([key, value]) => {
                        logContent[key] = value;
                    });
                } else {
                    logContent[`arg${index}`] = arg;
                }
            });
        }

        // Format the message for text output
        if (this.outputFormat === 'text') {
            const formattedLog = this.formatMessage(logContent);
            await this.writeToOutput(formattedLog + '\n');
        } else if (this.outputFormat === 'json') {
            await this.writeToOutput(JSON.stringify(logContent) + '\n');
        }
    }

    private async writeToOutput(text: string): Promise<void> {
        if (typeof Bun !== 'undefined') {
            // Bun environment
            await Bun.write(Bun.stdout, text);
        } else {
            // Node.js environment
            process.stdout.write(text);
        }
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
            additionalFields: this.additionalFields
        });
    }
}

export default Logger;