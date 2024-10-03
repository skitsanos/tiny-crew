import type { Tool } from '@/utils/types.ts';

export class Database {
    async query(query: string): Promise<any> {
        return 'No results found';
    }
}

class DatabaseQueryTool implements Tool {
    name = 'DatabaseQuery';
    description = 'Query the database for information';
    private db: Database;

    schema = {
        name: 'DatabaseQuery',
        description: 'Query the database for information',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'The SQL query to execute on the database'
                }
            },
            required: ['query']
        }
    };

    constructor(db: Database) {
        this.db = db;
    }

    async use({ query }: { query: string }): Promise<any> {
        return await this.db.query(query);
    }
}

export default DatabaseQueryTool;