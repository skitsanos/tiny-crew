# Structured Output

TinyCrew supports structured output using Zod schemas, enabling type-safe JSON responses from agents. This feature uses OpenAI's structured output capability to guarantee responses match your defined schema.

## Overview

Structured output is useful when you need:
- **Data extraction** - Parse unstructured text into structured data
- **Type safety** - Guarantee response format matches your TypeScript types
- **Validation** - Automatic validation of LLM responses
- **Predictable parsing** - No need for fragile regex or string parsing

## Basic Usage

```typescript
import { Agent } from 'tiny-crew';
import { z } from 'zod';
import OpenAI from 'openai';

// Define your schema
const PersonSchema = z.object({
    name: z.string().describe('Person\'s full name'),
    age: z.number().describe('Person\'s age in years'),
    occupation: z.string().describe('Person\'s job or profession')
});

// Create agent with responseSchema
const extractor = new Agent({
    name: 'PersonExtractor',
    goal: 'Extract person information from text',
    responseSchema: {
        schema: PersonSchema,
        name: 'person_data'
    }
}, new OpenAI());

// Get structured response
const result = await extractor.performTask(
    'John Smith is a 45-year-old software architect.'
);

const person = JSON.parse(result);
// { name: 'John Smith', age: 45, occupation: 'software architect' }
```

## Schema Patterns

### Simple Object

```typescript
const TaskSchema = z.object({
    title: z.string().describe('Task title'),
    priority: z.enum(['low', 'medium', 'high', 'critical']),
    status: z.enum(['todo', 'in_progress', 'done']),
    estimatedHours: z.number().describe('Estimated hours to complete')
});
```

### Nested Objects

```typescript
const AddressSchema = z.object({
    street: z.string(),
    city: z.string(),
    country: z.string(),
    postalCode: z.string()
});

const CompanySchema = z.object({
    name: z.string().describe('Company name'),
    industry: z.string().describe('Industry sector'),
    employees: z.number().describe('Number of employees'),
    headquarters: AddressSchema.describe('Company headquarters'),
    isPublic: z.boolean().describe('Whether publicly traded')
});
```

### Arrays

```typescript
const MeetingNotesSchema = z.object({
    title: z.string(),
    date: z.string(),
    attendees: z.array(z.string()).describe('List of attendee names'),
    actionItems: z.array(z.object({
        task: z.string(),
        assignee: z.string(),
        dueDate: z.string()
    })).describe('Action items from the meeting'),
    summary: z.string()
});
```

### Nullable Fields

```typescript
const ProductSchema = z.object({
    name: z.string(),
    price: z.number(),
    category: z.string(),
    description: z.string().nullable().describe('Null if not available'),
    rating: z.number().nullable().describe('Null if no reviews'),
    inStock: z.boolean()
});
```

## Best Practices

### 1. Use Descriptive Field Names

Field names guide the LLM. Use clear, descriptive names:

```typescript
// Good
z.object({
    fullName: z.string(),
    emailAddress: z.string(),
    phoneNumber: z.string()
})

// Less clear
z.object({
    n: z.string(),
    e: z.string(),
    p: z.string()
})
```

### 2. Add Descriptions

Use `.describe()` to provide context:

```typescript
const schema = z.object({
    sentiment: z.enum(['positive', 'negative', 'neutral'])
        .describe('Overall sentiment of the text'),
    confidence: z.number()
        .describe('Confidence score from 0 to 1'),
    keywords: z.array(z.string())
        .describe('Key topics mentioned in the text')
});
```

### 3. Use Enums for Fixed Values

Enums constrain outputs to valid options:

```typescript
const ReviewSchema = z.object({
    rating: z.enum(['1', '2', '3', '4', '5']),
    category: z.enum(['product', 'service', 'delivery', 'support']),
    recommendation: z.enum(['yes', 'no', 'maybe'])
});
```

### 4. Validate After Parsing

Always validate the parsed response:

```typescript
const result = await agent.performTask(prompt);
const parsed = JSON.parse(result);

const validation = MySchema.safeParse(parsed);
if (!validation.success) {
    console.error('Validation failed:', validation.error);
    // Handle error
}

const data = validation.data; // Type-safe data
```

## Configuration

### Temperature

Lower temperature produces more consistent structured output:

```typescript
const agent = new Agent({
    name: 'Extractor',
    goal: 'Extract structured data',
    temperature: 0.1,  // Low temperature for consistency
    responseSchema: {
        schema: MySchema,
        name: 'data'
    }
}, client);
```

### Model Selection

More capable models handle complex schemas better:

```typescript
const agent = new Agent({
    name: 'ComplexExtractor',
    goal: 'Extract complex nested data',
    model: 'gpt-4o',  // Use more capable model for complex schemas
    responseSchema: {
        schema: ComplexNestedSchema,
        name: 'complex_data'
    }
}, client);
```

## Examples

### Entity Extraction

```typescript
const EntitySchema = z.object({
    people: z.array(z.object({
        name: z.string(),
        role: z.string().nullable()
    })),
    organizations: z.array(z.object({
        name: z.string(),
        type: z.string().nullable()
    })),
    locations: z.array(z.string()),
    dates: z.array(z.string())
});

const extractor = new Agent({
    name: 'EntityExtractor',
    goal: 'Extract named entities from text',
    responseSchema: { schema: EntitySchema, name: 'entities' }
}, client);

const result = await extractor.performTask(`
    Apple CEO Tim Cook announced at WWDC 2024 in Cupertino
    that the company would partner with OpenAI starting June 10th.
`);
```

### Sentiment Analysis

```typescript
const SentimentSchema = z.object({
    overall: z.enum(['positive', 'negative', 'neutral', 'mixed']),
    score: z.number().describe('Score from -1 (negative) to 1 (positive)'),
    aspects: z.array(z.object({
        topic: z.string(),
        sentiment: z.enum(['positive', 'negative', 'neutral']),
        quote: z.string().nullable()
    }))
});

const analyzer = new Agent({
    name: 'SentimentAnalyzer',
    goal: 'Analyze sentiment in customer feedback',
    responseSchema: { schema: SentimentSchema, name: 'sentiment' }
}, client);
```

### Data Transformation

```typescript
const NormalizedContactSchema = z.object({
    firstName: z.string(),
    lastName: z.string(),
    email: z.string().email(),
    phone: z.string().nullable(),
    company: z.string().nullable(),
    title: z.string().nullable()
});

const normalizer = new Agent({
    name: 'ContactNormalizer',
    goal: 'Normalize contact information into standard format',
    responseSchema: { schema: NormalizedContactSchema, name: 'contact' }
}, client);

// Works with various input formats
await normalizer.performTask('John Smith, john@example.com, CEO at Acme Corp');
await normalizer.performTask('Contact: Jane Doe <jane.doe@company.org> - Software Engineer');
```

## See Also

- [Getting Started](./getting-started.md) - Basic setup
- [Custom Tools](./custom-tools.md) - Combining structured output with tools
- [Testing Guide](./testing.md) - Testing structured output agents
