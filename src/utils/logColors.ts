/**
 * ANSI color helpers for the Logger.
 *
 * Pure functions: hex/named color parsing, contrast adjustment, and ANSI
 * escape generation. Kept separate from Logger to isolate the color math.
 */

export interface Rgb {
    r: number;
    g: number;
    b: number;
}

const NAMED_COLORS: Record<string, [number, number, number]> = {
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

/** Parse a #rgb or #rrggbb hex string into RGB components */
export function hexToRgb(hexColor: string): Rgb | undefined {
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

/** Resolve a hex or named color to RGB components */
export function colorToRgb(color: string): Rgb | undefined {
    if (color.startsWith('#')) {
        return hexToRgb(color);
    }

    const tuple = NAMED_COLORS[color];
    if (tuple) {
        const [r, g, b] = tuple;
        return { r, g, b };
    }

    return undefined;
}

/** Brighten a color if it would be too dark to read on a dark terminal */
export function ensureContrast({ r, g, b }: Rgb): Rgb {
    const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
    const target = 165;

    if (brightness >= target) {
        return { r, g, b };
    }

    const factor = target / Math.max(brightness, 1);
    const adjust = (value: number) => Math.min(255, Math.round(value * factor));

    return { r: adjust(r), g: adjust(g), b: adjust(b) };
}

/** Build a 24-bit ANSI foreground escape sequence */
export function rgbToAnsi({ r, g, b }: Rgb): string {
    return `\x1b[38;2;${r};${g};${b}m`;
}

/** Resolve a color name/hex to an ANSI escape, or undefined if unparseable */
export function resolveAnsiColor(color: string): string | undefined {
    const rgb = colorToRgb(color.trim().toLowerCase());
    if (!rgb) {
        return undefined;
    }
    return rgbToAnsi(ensureContrast(rgb));
}

/** Wrap text in an ANSI color sequence (no-op when disabled or unparseable) */
export function colorizeText(
    text: string,
    color: string | undefined,
    enabled: boolean,
): string {
    if (!enabled || !color) {
        return text;
    }

    const ansiSequence = resolveAnsiColor(color);
    return ansiSequence ? `${ansiSequence}${text}\x1b[0m` : text;
}
