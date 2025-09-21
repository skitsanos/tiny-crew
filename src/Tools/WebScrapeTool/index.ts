import { JSDOM } from 'jsdom';
import * as cheerio from 'cheerio';
import type {CheerioAPI} from 'cheerio';
import type {Element as DomElement} from 'domhandler';
import type { Tool, ToolSchema } from '@/utils/types.ts';
import Logger from '@/utils/logger.ts';

interface WebScrapeArgs {
    url: string;
    selector: string;
    type: 'text' | 'html' | 'table' | 'links' | 'images' | 'metadata';
    parseDom: boolean;
    timeout: number;
    userAgent: string;
}

/**
 * WebScrapeTool for retrieving content from websites using native fetch API
 */
 export class WebScrapeTool implements Tool {
    public readonly name = 'WebScrape';
    public readonly description = 'Scrape content from websites with various extraction options';
    private readonly logger: Logger;
    private readonly allowedDomains: string[] | null;
    private readonly blockedDomains: string[];
    private readonly maxResponseSize: number;
    private readonly defaultTimeout: number;
    private readonly defaultUserAgent: string;

    constructor(options: {
        allowedDomains?: string[];
        blockedDomains?: string[];
        maxResponseSize?: number;
        defaultTimeout?: number;
        defaultUserAgent?: string;
        logger?: Logger;
    } = {}) {
        // If allowedDomains is provided, only these domains are allowed
        // If null, all domains are allowed except those in blockedDomains
        this.allowedDomains = options.allowedDomains || null;
        this.blockedDomains = options.blockedDomains || [
            'localhost', '127.0.0.1', '0.0.0.0', 'internal', 'private', 'local'
        ];
        this.maxResponseSize = options.maxResponseSize || 5 * 1024 * 1024; // 5MB default
        this.defaultTimeout = options.defaultTimeout || 10000; // 10 seconds
        this.defaultUserAgent = options.defaultUserAgent ||
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
                    description: 'The URL to scrape content from'
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector to extract specific elements. Use "body" or "*" for all content if no specific selector needed.',
                    default: 'body'
                },
                type: {
                    type: 'string',
                    enum: ['text', 'html', 'table', 'links', 'images', 'metadata'],
                    description: 'Type of content to extract',
                    default: 'text'
                },
                parseDom: {
                    type: 'boolean',
                    description: 'Whether to parse the page using DOM',
                    default: false
                },
                timeout: {
                    type: 'number',
                    description: 'Request timeout in milliseconds',
                    default: 10000
                },
                userAgent: {
                    type: 'string',
                    description: 'Custom User-Agent string',
                    default: 'Mozilla/5.0 (compatible; TinyCrewBot/1.0; +https://github.com/skitsanos/tiny-crew)'
                }
            },
            required: ['url', 'selector', 'type', 'parseDom', 'timeout', 'userAgent']
        }
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

            // Extract domain from hostname
            const hostname = parsedUrl.hostname.toLowerCase();

            // Check for blocked domains
            for (const blockedDomain of this.blockedDomains) {
                if (hostname === blockedDomain || hostname.endsWith(`.${blockedDomain}`)) {
                    this.logger.warn(`Blocked domain: ${hostname}`);
                    return false;
                }
            }

            // If allowedDomains is set, check if the domain is allowed
            if (this.allowedDomains !== null) {
                const isAllowed = this.allowedDomains.some(domain =>
                    hostname === domain || hostname.endsWith(`.${domain}`)
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

        if (args.type && !['text', 'html', 'table', 'links', 'images', 'metadata'].includes(args.type)) {
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
     * Extract metadata from the HTML document
     */
    private extractMetadata(dom: JSDOM): Record<string, string> {
        const metadata: Record<string, string> = {};
        const document = dom.window.document;

        // Extract title
        const title = document.querySelector('title')?.textContent;
        if (title) metadata.title = title;

        // Extract meta tags
        const metaTags = document.querySelectorAll('meta');
        metaTags.forEach(meta => {
            const name = meta.getAttribute('name') || meta.getAttribute('property');
            const content = meta.getAttribute('content');
            if (name && content) {
                metadata[name] = content;
            }
        });

        return metadata;
    }

    /**
     * Extract links from the HTML document
     */
    private extractLinks($: CheerioAPI, baseUrl: string): Array<{text: string, url: string}> {
        const links: Array<{text: string, url: string}> = [];
        $('a[href]').each((_, element: DomElement) => {
            const linkElement = $(element);
            const href = linkElement.attr('href') || '';
            const text = linkElement.text().trim();

            try {
                // Resolve relative URLs against the base URL
                const url = new URL(href, baseUrl).href;
                links.push({ text, url });
            } catch (error) {
                this.logger.debug(`Skipping invalid URL: ${href}`);
            }
        });

        return links;
    }

    /**
     * Extract images from the HTML document
     */
    private extractImages($: CheerioAPI, baseUrl: string): Array<{alt: string, url: string}> {
        const images: Array<{alt: string, url: string}> = [];

        $('img[src]').each((_, element: DomElement) => {
            const imgElement = $(element);
            const src = imgElement.attr('src') || '';
            const alt = imgElement.attr('alt') || '';

            try {
                // Resolve relative URLs against the base URL
                const url = new URL(src, baseUrl).href;
                images.push({ alt, url });
            } catch (error) {
                this.logger.debug(`Skipping invalid image URL: ${src}`);
            }
        });

        return images;
    }

    /**
     * Extract tables from the HTML document
     */
    private extractTables($: CheerioAPI): Array<Array<Array<string>>> {
        const tables: Array<Array<Array<string>>> = [];

        $('table').each((_, tableEl: DomElement) => {
            const table: Array<Array<string>> = [];

            $(tableEl).find('tr').each((_, rowEl: DomElement) => {
                const row: Array<string> = [];

                // Handle both th and td cells
                $(rowEl).find('th, td').each((_, cellEl: DomElement) => {
                    row.push($(cellEl).text().trim());
                });

                if (row.length > 0) {
                    table.push(row);
                }
            });

            if (table.length > 0) {
                tables.push(table);
            }
        });

        return tables;
    }

    /**
     * Creates an AbortController and sets a timeout
     */
    private createTimeoutController(timeout: number): { controller: AbortController, signal: AbortSignal } {
        const controller = new AbortController();
        const signal = controller.signal;

        setTimeout(() => {
            controller.abort(`Request timed out after ${timeout}ms`);
        }, timeout);

        return { controller, signal };
    }

    /**
     * Extract content from a URL with various options using native fetch
     */
    public async use({
        url,
        selector = 'body',
        type = 'text',
        parseDom = false,
        timeout = this.defaultTimeout,
        userAgent = this.defaultUserAgent
    }: WebScrapeArgs): Promise<any> {
        this.logger.debug(`Scraping URL: ${url}`);

        if (!this.validateInput({ url, selector, type, parseDom, timeout, userAgent })) {
            throw new Error(`Invalid scraping request for URL: ${url}`);
        }

        try {
            // Set up timeout with AbortController
            const timeoutMs = timeout || this.defaultTimeout;
            const { signal } = this.createTimeoutController(timeoutMs);

            // Configure request headers
            const headers = new Headers({
                'User-Agent': userAgent || this.defaultUserAgent,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5'
            });

            // Make the HTTP request
            const response = await fetch(url, {
                headers,
                signal,
                redirect: 'follow'
            });

            // Check response status
            if (!response.ok) {
                throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
            }

            // Check content length if available
            const contentLength = response.headers.get('content-length');
            if (contentLength && parseInt(contentLength) > this.maxResponseSize) {
                throw new Error(`Response size exceeds maximum allowed size (${this.maxResponseSize} bytes)`);
            }

            // Get response text
            const html = await response.text();

            // Check actual content size
            if (html.length > this.maxResponseSize) {
                throw new Error(`Response size exceeds maximum allowed size (${this.maxResponseSize} bytes)`);
            }

            const finalUrl = response.url || url;

            // Load the HTML content with appropriate parser
            if (parseDom) {
                // Use JSDOM for full DOM support (heavier but more accurate)
                const dom = new JSDOM(html, { url: finalUrl });

                if (type === 'metadata') {
                    return this.extractMetadata(dom);
                }

                const document = dom.window.document;

                if (selector) {
                    const selectedElements = document.querySelectorAll(selector);

                    if (type === 'text') {
                        return Array.from(selectedElements).map(el => el.textContent?.trim()).filter(Boolean);
                    } else if (type === 'html') {
                        return Array.from(selectedElements).map(el => el.outerHTML).filter(Boolean);
                    }
                } else {
                    if (type === 'text') {
                        return document.body.textContent?.trim() || '';
                    } else if (type === 'html') {
                        return html;
                    }
                }
            } else {
                // Use Cheerio for faster parsing (lighter weight)
                const $ = cheerio.load(html);

                if (type === 'links') {
                    return this.extractLinks($, finalUrl);
                }

                if (type === 'images') {
                    return this.extractImages($, finalUrl);
                }

                if (type === 'table') {
                    return this.extractTables($);
                }

                if (selector) {
                    const elements = $(selector);

                    if (type === 'text') {
                        return elements.map((_, el) => $(el).text().trim()).get();
                    } else if (type === 'html') {
                        return elements.map((_, el) => $.html(el)).get();
                    }
                } else {
                    if (type === 'text') {
                        return $('body').text().trim();
                    } else if (type === 'html') {
                        return html;
                    }
                }
            }

            throw new Error(`Unsupported combination of type: ${type} and parseDom: ${parseDom}`);
        } catch (error:any) {
            this.logger.error(`Error scraping ${url}: ${error}`);

            // Enhance error information based on the error type
            if (error instanceof TypeError && error.message.includes('fetch')) {
                throw new Error(`Network error while fetching ${url}: ${error.message}`);
            } else if (error.name === 'AbortError') {
                throw new Error(`Request timeout after ${timeout || this.defaultTimeout}ms`);
            } else if (error instanceof DOMException && error.name === 'SyntaxError') {
                throw new Error(`Error parsing HTML from ${url}`);
            }

            // Pass through other errors
            throw error;
        }
    }
}

export default WebScrapeTool;
