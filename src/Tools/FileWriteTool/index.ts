import { writeFile } from 'fs/promises';
import {dirname, extname, isAbsolute, resolve} from 'path';
import type {Tool, ToolSchema} from '@/utils/types.ts';
import Logger from '@/utils/logger.ts';
import { mkdir } from 'fs/promises';
import logger from '@/utils/logger.ts';

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
    public readonly description = 'Write content to a file on the local filesystem with path validation';
    private readonly basePath: string;
    private readonly logger: Logger;
    private readonly allowedExtensions: string[];

    constructor(options: {
        basePath?: string,
        allowedExtensions?: string[],
        logger?: Logger
    } = {}) {
        this.basePath = options.basePath || process.cwd();


        this.allowedExtensions = options.allowedExtensions || ['.txt', '.md', '.json', '.js', '.ts', '.py', '.html', '.css'];
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
                    description: 'The name of the file to write to, including path if necessary'
                },
                content: {
                    type: 'string',
                    description: 'The content to write to the file'
                },
                overwrite: {
                    type: 'boolean',
                    description: 'Whether to overwrite the file if it exists'
                }
            },
            required: ['filename', 'content']
        }
    };

    /**
     * Validates the file path for security
     */
    private validateFilePath(filePath: string): boolean {
        // Resolve the absolute path
        const absolutePath = resolve(this.basePath, filePath);

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
    public validateInput(args: FileWriteArgs): boolean {
        if (!args.filename) {
            this.logger.warn('Invalid filename provided');
            return false;
        }

        if (!args.content) {
            this.logger.warn('Invalid content provided');
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
    public async use({ filename, content, overwrite = true }: FileWriteArgs): Promise<string> {
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
            if (!overwrite && (error as NodeJS.ErrnoException).code === 'EEXIST') {
                this.logger.warn(`File ${filename} already exists and overwrite is set to false`);
                throw new Error(`File ${filename} already exists and overwrite is set to false`);
            }
            this.logger.error(`Error writing to file: ${error}`);
            throw error;
        }
    }
}

export default FileWriteTool;