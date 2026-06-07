/**
 * HTML parsing helpers for WebScrapeTool.
 *
 * The heavy parsing dependencies (jsdom, cheerio) are optional and loaded
 * dynamically here so the rest of the tool can be imported without them.
 */

import type Logger from '@tinycrew/utils/logger';

// Optional dependencies - loaded dynamically
let JSDOM: typeof import('jsdom').JSDOM | null = null;
let cheerio: typeof import('cheerio') | null = null;

// Type imports for cheerio
type CheerioAPI = import('cheerio').CheerioAPI;
type DomElement = import('domhandler').Element;

try {
    JSDOM = (await import('jsdom')).JSDOM;
} catch {
    // jsdom not available
}

try {
    cheerio = await import('cheerio');
} catch {
    // cheerio not available
}

export type ScrapeType =
    | 'text'
    | 'html'
    | 'table'
    | 'links'
    | 'images'
    | 'metadata';

/** Report which optional parsing dependencies are installed */
export function getParserAvailability(): {
    available: boolean;
    missing: string[];
} {
    const missing: string[] = [];
    if (!cheerio) missing.push('cheerio');
    if (!JSDOM) missing.push('jsdom');
    return { available: cheerio !== null, missing };
}

/** Throw a helpful error when a required parsing dependency is missing */
export function assertDependencies(requireJsdom = false): void {
    if (!cheerio) {
        throw new Error(
            'WebScrapeTool requires cheerio. Install it with: bun add cheerio',
        );
    }
    if (requireJsdom && !JSDOM) {
        throw new Error(
            'WebScrapeTool with parseDom=true requires jsdom. Install it with: bun add jsdom',
        );
    }
}

/** Parse HTML with JSDOM (heavier, full DOM support) */
export function parseWithDom(
    html: string,
    finalUrl: string,
    selector: string,
    type: ScrapeType,
): unknown {
    const dom = new JSDOM!(html, { url: finalUrl });

    if (type === 'metadata') {
        return extractMetadata(dom);
    }

    const document = dom.window.document;

    if (selector) {
        const elements = document.querySelectorAll(selector);
        if (type === 'text') {
            return Array.from(elements)
                .map((el: Element) => el.textContent?.trim())
                .filter(Boolean);
        }
        if (type === 'html') {
            return Array.from(elements)
                .map((el: Element) => (el as HTMLElement).outerHTML)
                .filter(Boolean);
        }
    } else {
        if (type === 'text') {
            return document.body.textContent?.trim() || '';
        }
        if (type === 'html') {
            return html;
        }
    }

    throw unsupportedCombination(type, true);
}

/** Parse HTML with Cheerio (lighter, faster) */
export function parseWithCheerio(
    html: string,
    finalUrl: string,
    selector: string,
    type: ScrapeType,
    logger: Logger,
): unknown {
    const $ = cheerio!.load(html);

    if (type === 'links') return extractLinks($, finalUrl, logger);
    if (type === 'images') return extractImages($, finalUrl, logger);
    if (type === 'table') return extractTables($);

    if (selector) {
        const elements = $(selector);
        if (type === 'text') {
            return elements.map((_, el) => $(el).text().trim()).get();
        }
        if (type === 'html') {
            return elements.map((_, el) => $.html(el)).get();
        }
    } else {
        if (type === 'text') return $('body').text().trim();
        if (type === 'html') return html;
    }

    throw unsupportedCombination(type, false);
}

function unsupportedCombination(type: ScrapeType, parseDom: boolean): Error {
    return new Error(
        `Unsupported combination of type: ${type} and parseDom: ${parseDom}`,
    );
}

/** Extract metadata (title + meta tags) from the document */
function extractMetadata(
    dom: InstanceType<typeof import('jsdom').JSDOM>,
): Record<string, string> {
    const metadata: Record<string, string> = {};
    const document = dom.window.document;

    const title = document.querySelector('title')?.textContent;
    if (title) metadata.title = title;

    document.querySelectorAll('meta').forEach((meta: Element) => {
        const name = meta.getAttribute('name') || meta.getAttribute('property');
        const content = meta.getAttribute('content');
        if (name && content) {
            metadata[name] = content;
        }
    });

    return metadata;
}

/** Extract links, resolving relative URLs against the base URL */
function extractLinks(
    $: CheerioAPI,
    baseUrl: string,
    logger: Logger,
): Array<{ text: string; url: string }> {
    const links: Array<{ text: string; url: string }> = [];
    $('a[href]').each((_, element: DomElement) => {
        const linkElement = $(element);
        const href = linkElement.attr('href') || '';
        const text = linkElement.text().trim();
        try {
            links.push({ text, url: new URL(href, baseUrl).href });
        } catch {
            logger.debug(`Skipping invalid URL: ${href}`);
        }
    });
    return links;
}

/** Extract images, resolving relative URLs against the base URL */
function extractImages(
    $: CheerioAPI,
    baseUrl: string,
    logger: Logger,
): Array<{ alt: string; url: string }> {
    const images: Array<{ alt: string; url: string }> = [];
    $('img[src]').each((_, element: DomElement) => {
        const imgElement = $(element);
        const src = imgElement.attr('src') || '';
        const alt = imgElement.attr('alt') || '';
        try {
            images.push({ alt, url: new URL(src, baseUrl).href });
        } catch {
            logger.debug(`Skipping invalid image URL: ${src}`);
        }
    });
    return images;
}

/** Extract tables as arrays of rows of cell text */
function extractTables($: CheerioAPI): Array<Array<Array<string>>> {
    const tables: Array<Array<Array<string>>> = [];
    $('table').each((_, tableEl: DomElement) => {
        const table: Array<Array<string>> = [];
        $(tableEl)
            .find('tr')
            .each((_, rowEl: DomElement) => {
                const row: Array<string> = [];
                $(rowEl)
                    .find('th, td')
                    .each((_, cellEl: DomElement) => {
                        row.push($(cellEl).text().trim());
                    });
                if (row.length > 0) table.push(row);
            });
        if (table.length > 0) tables.push(table);
    });
    return tables;
}
