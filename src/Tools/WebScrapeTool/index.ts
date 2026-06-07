import Logger from '@tinycrew/utils/logger';
import type { Tool, ToolSchema } from '@tinycrew/utils/types';
import {
    assertDependencies,
    getParserAvailability,
    parseWithCheerio,
    parseWithDom,
    type ScrapeType,
} from './parsers';

interface WebScrapeArgs {
    url: string;
    selector: string;
    type: ScrapeType;
    parseDom: boolean;
    timeout: number;
    userAgent: string;
}

/**
 * WebScrapeTool for retrieving content from websites using the native fetch API.
 *
 * Parsing (jsdom / cheerio) lives in ./parsers; this class handles validation,
 * fetching, and dispatch.
 */
export class WebScrapeTool implements Tool {
    public readonly name = 'WebScrape';
    public readonly description =
        'Scrape content from websites with various extraction options';
    private readonly logger: Logger;
    private readonly allowedDomains: string[] | null;
    private readonly blockedDomains: string[];
    private readonly maxResponseSize: number;
    private readonly defaultTimeout: number;
    private readonly defaultUserAgent: string;

    constructor(
        options: {
            allowedDomains?: string[];
            blockedDomains?: string[];
            maxResponseSize?: number;
            defaultTimeout?: number;
            defaultUserAgent?: string;
            logger?: Logger;
        } = {},
    ) {
        // If allowedDomains is provided, only these domains are allowed
        // If null, all domains are allowed except those in blockedDomains
        this.allowedDomains = options.allowedDomains || null;
        this.blockedDomains = options.blockedDomains || [
            'localhost',
            '127.0.0.1',
            '0.0.0.0',
            'internal',
            'private',
            'local',
        ];
        this.maxResponseSize = options.maxResponseSize || 5 * 1024 * 1024; // 5MB default
        this.defaultTimeout = options.defaultTimeout || 10000; // 10 seconds
        this.defaultUserAgent =
            options.defaultUserAgent ||
            'Mozilla/5.0 (compatible; TinyCrewBot/1.0; +https://github.com/skitsanos/tiny-crew)';
        this.logger = options.logger || new Logger('WebScrapeTool');
    }

    public readonly schema: ToolSchema = {
        name: this.name,
        description: this.description,
        parameters: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'The URL to scrape content from',
                },
                selector: {
                    type: 'string',
                    description:
                        'CSS selector to extract specific elements. Use "body" or "*" for all content if no specific selector needed.',
                    default: 'body',
                },
                type: {
                    type: 'string',
                    enum: [
                        'text',
                        'html',
                        'table',
                        'links',
                        'images',
                        'metadata',
                    ],
                    description: 'Type of content to extract',
                    default: 'text',
                },
                parseDom: {
                    type: 'boolean',
                    description: 'Whether to parse the page using DOM',
                    default: false,
                },
                timeout: {
                    type: 'number',
                    description: 'Request timeout in milliseconds',
                    default: 10000,
                },
                userAgent: {
                    type: 'string',
                    description: 'Custom User-Agent string',
                    default:
                        'Mozilla/5.0 (compatible; TinyCrewBot/1.0; +https://github.com/skitsanos/tiny-crew)',
                },
            },
            required: [
                'url',
                'selector',
                'type',
                'parseDom',
                'timeout',
                'userAgent',
            ],
        },
    };

    /**
     * Validates the URL is allowed and properly formatted
     */
    private validateUrl(url: string): boolean {
        try {
            const parsedUrl = new URL(url);

            // Check for blocked protocols
            if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
                this.logger.warn(`Blocked protocol: ${parsedUrl.protocol}`);
                return false;
            }

            const hostname = parsedUrl.hostname.toLowerCase();

            // Check for blocked domains
            for (const blockedDomain of this.blockedDomains) {
                if (
                    hostname === blockedDomain ||
                    hostname.endsWith(`.${blockedDomain}`)
                ) {
                    this.logger.warn(`Blocked domain: ${hostname}`);
                    return false;
                }
            }

            // If allowedDomains is set, check if the domain is allowed
            if (this.allowedDomains !== null) {
                const isAllowed = this.allowedDomains.some(
                    (domain) =>
                        hostname === domain || hostname.endsWith(`.${domain}`),
                );

                if (!isAllowed) {
                    this.logger.warn(`Domain not in allowed list: ${hostname}`);
                    return false;
                }
            }

            return true;
        } catch (error) {
            this.logger.warn(`Invalid URL: ${error}`);
            return false;
        }
    }

    /**
     * Validates all input arguments
     */
    public validateInput(args: WebScrapeArgs): boolean {
        if (!args.url) {
            this.logger.warn('URL not provided');
            return false;
        }

        if (!this.validateUrl(args.url)) {
            return false;
        }

        if (
            args.type &&
            !['text', 'html', 'table', 'links', 'images', 'metadata'].includes(
                args.type,
            )
        ) {
            this.logger.warn(`Invalid type: ${args.type}`);
            return false;
        }

        return true;
    }

    /**
     * Returns the capabilities of this tool
     */
    public getCapabilities(): string[] {
        return ['web_scraping', 'data_extraction', 'content_analysis'];
    }

    /**
     * Check if WebScrapeTool dependencies are available
     */
    public static isAvailable(): { available: boolean; missing: string[] } {
        return getParserAvailability();
    }

    /**
     * Fetch the page HTML, enforcing timeout and response-size limits.
     */
    private async fetchHtml(
        url: string,
        timeout: number,
        userAgent: string,
    ): Promise<{ html: string; finalUrl: string }> {
        const controller = new AbortController();
        const timer = setTimeout(
            () => controller.abort(`Request timed out after ${timeout}ms`),
            timeout,
        );

        try {
            const headers = new Headers({
                'User-Agent': userAgent || this.defaultUserAgent,
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
            });

            const response = await fetch(url, {
                headers,
                signal: controller.signal,
                redirect: 'follow',
            });

            if (!response.ok) {
                throw new Error(
                    `HTTP error ${response.status}: ${response.statusText}`,
                );
            }

            this.assertWithinSizeLimit(response.headers.get('content-length'));

            const html = await response.text();
            if (html.length > this.maxResponseSize) {
                throw new Error(
                    `Response size exceeds maximum allowed size (${this.maxResponseSize} bytes)`,
                );
            }

            return { html, finalUrl: response.url || url };
        } finally {
            clearTimeout(timer);
        }
    }

    /** Throw if the advertised content-length exceeds the configured limit */
    private assertWithinSizeLimit(contentLength: string | null): void {
        if (
            contentLength &&
            parseInt(contentLength, 10) > this.maxResponseSize
        ) {
            throw new Error(
                `Response size exceeds maximum allowed size (${this.maxResponseSize} bytes)`,
            );
        }
    }

    /**
     * Extract content from a URL with various options using native fetch.
     */
    public async use({
        url,
        selector = 'body',
        type = 'text',
        parseDom = false,
        timeout = this.defaultTimeout,
        userAgent = this.defaultUserAgent,
    }: WebScrapeArgs): Promise<unknown> {
        this.logger.debug(`Scraping URL: ${url}`);

        assertDependencies(parseDom);

        if (
            !this.validateInput({
                url,
                selector,
                type,
                parseDom,
                timeout,
                userAgent,
            })
        ) {
            throw new Error(`Invalid scraping request for URL: ${url}`);
        }

        try {
            const { html, finalUrl } = await this.fetchHtml(
                url,
                timeout || this.defaultTimeout,
                userAgent,
            );

            return parseDom
                ? parseWithDom(html, finalUrl, selector, type)
                : parseWithCheerio(html, finalUrl, selector, type, this.logger);
        } catch (error: any) {
            this.logger.error(`Error scraping ${url}: ${error}`);
            throw this.normalizeError(error, url, timeout);
        }
    }

    /** Map low-level fetch/parse failures to clearer error messages */
    private normalizeError(error: any, url: string, timeout: number): Error {
        if (error instanceof TypeError && error.message.includes('fetch')) {
            return new Error(
                `Network error while fetching ${url}: ${error.message}`,
            );
        }
        if (error.name === 'AbortError') {
            return new Error(
                `Request timeout after ${timeout || this.defaultTimeout}ms`,
            );
        }
        if (error instanceof DOMException && error.name === 'SyntaxError') {
            return new Error(`Error parsing HTML from ${url}`);
        }
        return error;
    }
}

export default WebScrapeTool;
