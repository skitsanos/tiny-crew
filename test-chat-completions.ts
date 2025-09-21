import OpenAI from 'openai';
import FileWriteTool from './src/Tools/FileWriteTool';

const openai = new OpenAI();

async function testChatCompletions() {
    const fileWriteTool = new FileWriteTool();

    console.log('Testing with chat.completions.create...');

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'user',
                    content: 'Write "Hello World" to a file called test.txt using the FileWrite tool'
                }
            ],
            tools: [
                {
                    type: 'function',
                    function: {
                        name: fileWriteTool.schema.name,
                        description: fileWriteTool.schema.description,
                        parameters: fileWriteTool.schema.parameters
                    }
                }
            ]
        });

        console.log('Response:', JSON.stringify(response, null, 2));

        const toolCalls = response.choices[0].message.tool_calls || [];
        console.log('Tool calls found:', toolCalls.length);

        toolCalls.forEach((call, i) => {
            console.log(`Call ${i}:`, {
                name: call.function.name,
                arguments: call.function.arguments,
                parsedArgs: JSON.parse(call.function.arguments || '{}')
            });
        });

    } catch (error) {
        console.error('Error:', error);
    }
}

testChatCompletions();