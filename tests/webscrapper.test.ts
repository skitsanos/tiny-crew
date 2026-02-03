import { afterAll, beforeAll, expect, it } from 'bun:test';
import { WebScrapeTool } from '@tinycrew/Tools/WebScrapeTool';

const scraper = new WebScrapeTool({
    allowedDomains: ['localhost'],
    blockedDomains: [],
});

const htmlFixture = `<!DOCTYPE html>
<html lang="en">
  <head>
    <title>Tiny Crew Test Page</title>
  </head>
  <body>
    <main>
      <h1 data-test="headline">Hello from Tiny Crew</h1>
    </main>
  </body>
</html>`;

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

function startServer(): ReturnType<typeof Bun.serve> {
    const envPort = process.env.TINYCREW_TEST_PORT
        ? Number(process.env.TINYCREW_TEST_PORT)
        : null;

    const basePort = envPort ?? 40000 + (process.pid % 10000);
    const maxAttempts = 200;

    for (let i = 0; i < maxAttempts; i++) {
        const port = basePort + i;
        try {
            return Bun.serve({
                port,
                hostname: '127.0.0.1',
                fetch() {
                    return new Response(htmlFixture, {
                        headers: {
                            'Content-Type': 'text/html; charset=utf-8',
                        },
                    });
                },
            });
        } catch {
            // Try next port.
        }
    }

    throw new Error(
        `No free port found starting at ${basePort}. Set TINYCREW_TEST_PORT to override.`,
    );
}

beforeAll(() => {
    server = startServer();

    baseUrl = `http://localhost:${server.port}`;
});

afterAll(() => {
    server?.stop(true);
});

it('scrapes the page title when DOM parsing is enabled', async () => {
    const result = await scraper.use({
        url: `${baseUrl}/`,
        selector: 'title',
        type: 'text',
        parseDom: true,
        timeout: 10000,
        userAgent:
            'Mozilla/5.0 (compatible; TinyCrewBot/1.0; +https://github.com/skitsanos/tiny-crew)',
    });

    expect(result).toEqual(['Tiny Crew Test Page']);
});

it('returns text content with the default parser', async () => {
    const result = await scraper.use({
        url: `${baseUrl}/`,
        selector: 'h1[data-test="headline"]',
        type: 'text',
        parseDom: false,
        timeout: 10000,
        userAgent:
            'Mozilla/5.0 (compatible; TinyCrewBot/1.0; +https://github.com/skitsanos/tiny-crew)',
    });

    expect(result).toEqual(['Hello from Tiny Crew']);
});
