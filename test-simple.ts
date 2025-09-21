import OpenAI from 'openai';
import FileWriteTool from './src/Tools/FileWriteTool';

const openai = new OpenAI();

async function testSimpleToolCall() {
    const fileWriteTool = new FileWriteTool();

    console.log('FileWriteTool schema:', JSON.stringify(fileWriteTool.schema, null, 2));

    try {
        const response = await openai.responses.create({
            model: 'gpt-4o-mini',
            input: [
                {
                    type: 'message',
                    role: 'user',
                    content: [
                        {
                            type: 'input_text',
                            text: 'Write "Hello World" to a file called test.txt using the FileWrite tool'
                        }
                    ]
                }
            ],
            tools: [
                {
                    type: 'function',
                    name: fileWriteTool.schema.name,
                    description: fileWriteTool.schema.description,
                    parameters: {
                        ...fileWriteTool.schema.parameters,
                        additionalProperties: false
                    },
                    strict: true
                }
            ]
        });

        console.log('Response:', JSON.stringify(response, null, 2));

        const functionCalls = response.output?.filter(item => item.type === 'function_call') || [];
        console.log('Function calls found:', functionCalls.length);

        functionCalls.forEach((call, i) => {
            console.log(`Call ${i}:`, {
                name: call.name,
                arguments: call.arguments,
                parsedArgs: JSON.parse(call.arguments || '{}')
            });
        });

    } catch (error) {
        console.error('Error:', error);
    }
}

testSimpleToolCall();