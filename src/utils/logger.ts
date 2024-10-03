/**
 * Application logging for bun driven applications
 * @version 2.0.0
 */
import {hostname} from 'os';
import dayjs from 'dayjs';

const getEnumValue = (enumType: any, enumKey: string): number | undefined => enumType[enumKey];

enum LOG_ENTRY_TYPE
{
    TRACE,
    DEBUG,
    INFO,
    WARN,
    ERROR,
    FATAL
}

type OutputFormat = 'text' | 'json';

interface LoggerOptions
{
    outputFormat?: OutputFormat;
    format?: string;
}

class Logger
{
    private readonly context: string;
    private readonly outputFormat: string;
    private format: string;

    constructor(context: string, options: LoggerOptions = {})
    {
        const {
            LOG_OUTPUT_FORMAT,
            LOG_FORMAT
        } = process.env as Record<string, string>;

        const {
            outputFormat = LOG_OUTPUT_FORMAT ?? 'text',
            format = LOG_FORMAT || '{timestamp} [{level}] {context}: {message}'
        } = options;

        this.context = context;
        this.outputFormat = outputFormat;
        this.format = format;

        // Dynamically create logging methods for each log level
        Object.keys(LOG_ENTRY_TYPE).forEach(key =>
        {
            if (isNaN(Number(key)))
            {
                (this as any)[key.toLowerCase()] = (data: any, ...args: any[]) => this.writeLog(LOG_ENTRY_TYPE[key as keyof typeof LOG_ENTRY_TYPE], data, ...args);
            }
        });
    }

    private async writeLog(level: LOG_ENTRY_TYPE, data: any, ...args: any[])
    {
        const {LOG_LEVEL} = process.env as Record<string, string>;
        if (LOG_LEVEL && level < (getEnumValue(LOG_ENTRY_TYPE, LOG_LEVEL.toUpperCase()) || 0))
        {
            return;
        }

        const logContent: Record<string, any> = {
            timestamp: dayjs().format('YYYY-MM-DD hh:mm:ss'),
            host: hostname(),
            level: LOG_ENTRY_TYPE[level],
            context: this.context,
            message: data
        };

        if (args.length > 0)
        {
            for (const arg of args)
            {
                if (typeof arg === 'object')
                {
                    for (const key of Object.keys(arg))
                    {
                        logContent[`${key}`] = arg[key];
                    }
                }
                else
                {
                    const index = args.indexOf(arg);
                    logContent[`arg${index}`] = arg;
                }
            }
        }

        if (this.outputFormat === 'text')
        {
            const formattedLog = this.format.replace(/{(\w+)}/g, (_, key) => logContent[key] ?? '');
            await Bun.write(Bun.stdout, formattedLog + '\n');
        }

        if (this.outputFormat === 'json')
        {
            await Bun.write(Bun.stdout, JSON.stringify(logContent) + '\n');
        }
    }

    // TRACE level logging
    trace(message: string, ...args: any[]): void
    {
    }

    // DEBUG level logging
    debug(message: string, ...args: any[]): void
    {
    }

    // INFO level logging
    info(message: string, ...args: any[]): void
    {
    }

    // WARN level logging
    warn(message: string, ...args: any[]): void
    {
    }

    // ERROR level logging
    error(message: string, ...args: any[]): void
    {
    }

    // FATAL level logging
    fatal(data: any, ...args: any[]): void
    {
    }
}

export default Logger;