import type { Tool } from '@/utils/types.ts';
import { writeFile } from 'fs/promises';

class FileWriteTool implements Tool {
    name = 'FileWrite';
    description = 'Write content to a file on the local filesystem';

    schema = {
        name: 'FileWrite',
        description: 'Write content to a file on the local filesystem',
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
                }
            },
            required: ['filename', 'content']
        }
    };

    async use({ filename, content }: { filename: string; content: string }): Promise<string> {
        await writeFile(filename, content);
        return `Content successfully written to ${filename}`;
    }
}

export default FileWriteTool;