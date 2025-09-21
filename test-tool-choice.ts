import OpenAI from 'openai';
import FileWriteTool from './src/Tools/FileWriteTool';

const openai = new OpenAI();

async function testToolChoice() {
    const fileWriteTool = new FileWriteTool();

    console.log('Testing tool_choice with Responses API...');

    const tools = [{
        type: 'function',
        name: fileWriteTool.schema.name,
        description: fileWriteTool.schema.description,
        parameters: {
            ...fileWriteTool.schema.parameters,
            additionalProperties: false
        },
        strict: true
    }];

    console.log('Tools:', JSON.stringify(tools, null, 2));

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
                            text: 'Write "Hello World" to a file called test.txt'
                        }
                    ]
                }
            ],
            tools: tools,
            tool_choice: {
                type: "function",
                name: "FileWrite"
            }
        });

        console.log('Response status:', response.status);
        console.log('Response output length:', response.output?.length || 0);

        const functionCalls = response.output?.filter(item => item.type === 'function_call') || [];
        console.log('Function calls found:', functionCalls.length);

        if (functionCalls.length > 0) {
            functionCalls.forEach((call, i) => {
                console.log(`Call ${i}:`, {
                    name: call.name,
                    arguments: call.arguments,
                    parsedArgs: JSON.parse(call.arguments || '{}')
                });
            });
        } else {
            console.log('No function calls - here is the full output:');
            response.output?.forEach((item, i) => {
                console.log(`Output ${i}:`, item);
            });
        }

    } catch (error) {
        console.error('Error:', error);
    }
}

testToolChoice();