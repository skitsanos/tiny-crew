import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import Logger from '@/utils/logger.ts';
import type { Tool, ToolResultMetadata, ToolSchema } from '@/utils/types.ts';

interface FileWriteArgs {
    filename: string;
    content: string;
    overwrite?: boolean;
}

/**
 * Enhanced FileWriteTool with safety features and validation
 */
export class FileWriteTool implements Tool {
    public readonly name = 'FileWrite';
    public readonly description =
        'Write content to a file on the local filesystem with path validation';
    private readonly basePath: string;
    private readonly logger: Logger;
    private readonly allowedExtensions: string[];

    constructor(
        options: {
            basePath?: string;
            allowedExtensions?: string[];
            logger?: Logger;
        } = {},
    ) {
        this.basePath = resolve(options.basePath || process.cwd());
        this.allowedExtensions = options.allowedExtensions || [
            '.txt',
            '.md',
            '.json',
            '.js',
            '.ts',
            '.py',
            '.html',
            '.css',
        ];
        this.logger = options.logger || new Logger('FileWriteTool');
    }

    public readonly schema: ToolSchema = {
        name: this.name,
        description: this.description,
        parameters: {
            type: 'object',
            properties: {
                filename: {
                    type: 'string',
                    description:
                        'The name of the file to write to, including path if necessary',
                },
                content: {
                    type: 'string',
                    description: 'The content to write to the file',
                },
                overwrite: {
                    type: 'boolean',
                    description: 'Whether to overwrite the file if it exists',
                    default: true,
                },
            },
            required: ['filename', 'content', 'overwrite'],
        },
    };

    /**
     * Validates the file path for security
     */
    private validateFilePath(filePath: string): boolean {
        const absolutePath = resolve(this.basePath, filePath);

        // Ensure the resolved path stays within the configured base path
        const relativePath = relative(this.basePath, absolutePath);
        const normalizedRelative = relativePath.replace(/\\/g, '/');
        const escapesBase =
            normalizedRelative.length === 0 ||
            normalizedRelative === '.' ||
            normalizedRelative.startsWith('..') ||
            normalizedRelative.split('/').some((segment) => segment === '..');

        if (escapesBase) {
            this.logger.warn(
                `Attempt to write outside of base path: ${absolutePath}`,
            );
            return false;
        }

        // Check file extension is allowed
        const ext = extname(absolutePath).toLowerCase();
        if (!this.allowedExtensions.includes(ext)) {
            this.logger.warn(`File extension not allowed: ${ext}`);
            return false;
        }

        return true;
    }

    /**
     * Validates all input arguments
     */
    public validateInput(
        rawArgs: FileWriteArgs | Record<string, any>,
    ): boolean {
        // Check for undefined/null content BEFORE normalizing (normalizeArgs converts them to empty string)
        if (rawArgs && typeof rawArgs === 'object') {
            const candidate = rawArgs as Record<string, unknown>;
            const contentCandidate =
                candidate.content ?? candidate.text ?? candidate.data;

            if (contentCandidate === undefined || contentCandidate === null) {
                this.logger.warn(
                    'Content is required (use empty string to clear file)',
                );
                return false;
            }
        }

        const args = this.normalizeArgs(rawArgs);

        if (!args.filename) {
            this.logger.warn('Invalid filename provided');
            return false;
        }

        return this.validateFilePath(args.filename);
    }

    /**
     * Returns the capabilities of this tool
     */
    public getCapabilities(): string[] {
        return ['file_writing', 'data_persistence'];
    }

    /**
     * Write content to a file
     */
    public async use(
        rawArgs: FileWriteArgs | Record<string, any>,
    ): Promise<string> {
        const { filename, content, overwrite } = this.normalizeArgs(rawArgs);

        this.logger.debug(`Writing to file: ${filename}, ${this.basePath}`);

        if (!this.validateInput({ filename, content, overwrite })) {
            throw new Error(`Invalid file path or content: ${filename}`);
        }

        const absolutePath = resolve(this.basePath, filename);

        // Create directory if it doesn't exist
        const directory = dirname(absolutePath);
        await mkdir(directory, { recursive: true });

        // Write file with appropriate flags
        const options = { flag: overwrite ? 'w' : 'wx' };

        try {
            await writeFile(absolutePath, content, options);
            this.logger.info(`Content successfully written to ${filename}`);
            return `Content successfully written to ${filename}`;
        } catch (error) {
            if (
                !overwrite &&
                (error as NodeJS.ErrnoException).code === 'EEXIST'
            ) {
                this.logger.warn(
                    `File ${filename} already exists and overwrite is set to false`,
                );
                throw new Error(
                    `File ${filename} already exists and overwrite is set to false`,
                );
            }
            this.logger.error(`Error writing to file: ${error}`);
            throw error;
        }
    }

    public annotateResult(): ToolResultMetadata {
        return { success: true };
    }

    private isNonEmptyString(value: unknown): value is string {
        return typeof value === 'string' && value.trim().length > 0;
    }

    private normalizeArgs(
        raw: FileWriteArgs | Record<string, any>,
    ): FileWriteArgs {
        if (raw && typeof raw === 'object') {
            const candidate = raw as Record<string, unknown>;
            const filenameCandidate =
                candidate.filename ??
                candidate.fileName ??
                candidate.path ??
                candidate.filepath ??
                candidate.file_path;
            const contentCandidate =
                candidate.content ?? candidate.text ?? candidate.data;
            const overwriteCandidate =
                candidate.overwrite ?? candidate.force ?? candidate.replace;

            const filename = this.isNonEmptyString(filenameCandidate)
                ? filenameCandidate.trim()
                : '';

            let content: string = '';
            if (typeof contentCandidate === 'string') {
                // Keep string content as-is (including empty strings)
                content = contentCandidate;
            } else if (
                contentCandidate !== undefined &&
                contentCandidate !== null
            ) {
                // Non-string, non-null/undefined: serialize to JSON
                try {
                    content = JSON.stringify(contentCandidate, null, 2);
                } catch {
                    content = String(contentCandidate);
                }
            }

            const overwrite =
                overwriteCandidate === undefined
                    ? true
                    : Boolean(overwriteCandidate);

            return { filename, content, overwrite };
        }

        return {
            filename: '',
            content: '',
            overwrite: true,
        };
    }
}

export default FileWriteTool;
