import OpenAI from 'openai';

const openai = new OpenAI();

console.log('Available methods on client.responses:');
console.log(Object.getOwnPropertyNames(openai.responses));

console.log('\nAll properties and methods on responses:');
const descriptors = Object.getOwnPropertyDescriptors(openai.responses);
Object.keys(descriptors).forEach(key => {
    const desc = descriptors[key];
    console.log(`- ${key}: ${typeof desc.value} ${desc.value?.name || ''}`);
});

console.log('\nChecking responses prototype:');
const proto = Object.getPrototypeOf(openai.responses);
console.log('Prototype methods:', Object.getOwnPropertyNames(proto));

console.log('\nTesting if create method exists:');
console.log('create:', typeof openai.responses.create);

console.log('\nTesting what happens when we try submit_tool_outputs:');
console.log('submit_tool_outputs:', typeof openai.responses.submit_tool_outputs);