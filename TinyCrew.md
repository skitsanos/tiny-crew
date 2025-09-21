# TinyCrew

TinyCrew is a TypeScript framework that orchestrates multiple AI agents to solve complex tasks collaboratively. It features:

- **Agent System**: Specialized AI assistants with distinct goals and tools
- **Crew Management**: Central coordinator that assigns tasks to appropriate agents
- **Shared Memory**: Knowledge transfer between agents
- **Tool Integration**: Extensible system for agents to interact with external services using OpenAI Responses API
- **Event System**: Monitoring of task progress and memory updates
- **Error Handling**: Robust recovery and reporting with automatic retry mechanisms
- **Logging**: Comprehensive activity tracking



The project enables complex AI workflows by breaking them into specialized sub-tasks, much like a team of experts working together. Applications include creative writing, research analysis, code generation, and other scenarios where multiple specialized skills are needed to achieve a cohesive outcome.

Source code is available on https://github.com/skitsanos/tiny-crew

From my perspective, TinyCrew represents a solid foundation for many agentic tasks, but with some important considerations:

**Strengths:**



- The multi-agent architecture with specialized roles works well for collaborative tasks
- The shared memory system enables effective knowledge building between agents
- The event system provides good visibility into the process
- Tool integration allows for real-world interactions
- The reflection capability enables some self-improvement



**Limitations:**



- It lacks long-term memory persistence between sessions
- Built-in web scraping capabilities with security controls and domain filtering
- The task planning is relatively simple compared to more sophisticated planning frameworks
- It doesn't have built-in knowledge graph or vector storage for more complex information relationships
- There's limited autonomous decision-making about which tasks to perform next



For many practical use cases like content creation, basic research, and collaborative problem-solving, TinyCrew provides enough structure to be effective. The framework is particularly well-suited for tasks where:



1. The workflow is relatively well-defined
2. Tasks can be cleanly divided between specialized agents
3. The scope is contained within a single session
4. Tool usage is straightforward



For more complex scenarios involving dynamic planning, autonomous exploration, or long-running processes, you might need to extend TinyCrew with additional capabilities or integrate it with other systems.

What I find most valuable about TinyCrew is that it provides a clean, understandable architecture that can be incrementally enhanced as needs grow. You've created a foundation that's approachable enough for practical use while remaining extensible for more advanced applications.

Before I forget, let's explore the memory system in TinyCrew - it's one of the core components enabling effective collaboration between agents.

### How Memory Works in TinyCrew

At its core, the shared memory system in TinyCrew is what allows multiple agents to build on each other's work. Here's how it functions:



1. **Structure**: Memory is implemented as a key-value store where each entry contains:
2. **Update Mechanism**: When an agent completes a task, its results are automatically stored in shared memory:
3. **Access Pattern**: When a new task is assigned, the agent receives the current state of shared memory:
4. **Event Notification**: Memory updates trigger events that the crew and other components can listen for:



### Benefits of the Memory System



1. **Knowledge Building**: Each agent can build upon information discovered by other agents rather than starting from scratch.
2. **Task Context**: Agents understand what has already been accomplished and can refer to specific information from previous tasks.
3. **Coherent Outputs**: The final output integrates contributions from all agents into a cohesive whole.
4. **Temporal Context**: Timestamps allow agents to understand the sequence of discoveries and changes.
5. **Attribution**: The system tracks which agent generated which information, enabling proper credit and context.



### Practical Applications



1. **Research Tasks**: One agent finds basic information, another analyzes it, and a third synthesizes the findings.
2. **Creative Writing**: As we've seen in the Creative Writing example, different agents can handle plot, characters, and dialogue, with each building on the others' work.
3. **Code Development**: One agent can design an architecture, another can implement specific functions, and a third can write tests - all sharing their progress.
4. **Problem Solving**: Complex problems can be broken down, with different agents tackling different aspects and sharing insights.



### Memory Handling Example

```
// In a custom task workflow
async function analyzeDocument(crew, documentText) {
  // First agent extracts key points
  await crew.assignTask(`Extract the main points from: ${documentText.substring(0, 1000)}...`);
  
  // Second agent analyzes the points (with access to first agent's findings)
  await crew.assignTask("Analyze the main points and identify patterns or insights");
  
  // Third agent makes recommendations based on all previous work
  await crew.assignTask("Based on the analysis, provide 3 actionable recommendations");
  
  // The final response incorporates all the shared knowledge
  return await crew.provideFinalResponse("Synthesize the analysis into a concise report");
} 
```

The shared memory system is what makes TinyCrew truly collaborative rather than just a sequence of independent agents. It enables emergent intelligence where the collective output is greater than what any individual agent could produce alone.

Would you like me to elaborate on any specific aspect of the memory system, such as advanced memory management or ways to extend it for specific use cases?

### TinyCrew Improvements: From Initial to Enhanced Version

The evolution of TinyCrew includes several significant improvements:

**API Modernization (Version 2.3.0+):**

- **OpenAI Responses API Migration**: Upgraded from Chat Completions API to Responses API for better tool calling support
- **Strict Mode Tool Schemas**: All tool parameters now properly defined for OpenAI's strict mode requirements
- **Enhanced Tool Calling**: More reliable tool execution with proper argument parsing and validation
- **Automatic Retry Logic**: Robust error handling with configurable retry mechanisms

**Architectural Enhancements:**

- Implemented a robust task management system with tracking, statuses, and dependencies
- Added an event-driven architecture for better monitoring and communication
- Created a more structured memory system with timestamps and metadata
- Enhanced type safety throughout the codebase with comprehensive TypeScript interfaces
- Consolidated file organization with all outputs directed to `data/` folder

**Agent Capabilities:**

- Added reflection capability for agents to analyze their own performance
- Implemented agent specialization with detailed capabilities lists
- Enhanced tool integration with validation and security features
- Improved prompt engineering with customizable system prompts
- Fixed infinite loop issues in tool calling workflow

**Execution Flow:**

- Added parallel task execution for improved efficiency
- Implemented a task queue system for better workflow management
- Enhanced error handling and recovery mechanisms with retry logic
- Added more sophisticated agent selection logic
- Streamlined tool calling process using Responses API format

**Developer Experience:**

- Improved logging system with levels, formatting, and colorization
- Enhanced configuration options throughout the framework
- Added better documentation and type definitions
- Implemented a cleaner project structure for better organization
- Comprehensive examples with consistent themes and proper API usage

**Security & Reliability:**

- Added path validation for file operations
- Implemented input validation for tool usage
- Enhanced error reporting and handling
- Added more robust environment variable management
- Web scraping security controls with domain allowlists and blocklists

These improvements transform TinyCrew from a basic proof-of-concept into a production-ready framework suitable for real-world applications, while maintaining the core simplicity that makes it approachable and extensible. 

## Practical Scenarios for TinyCrew Implementation

### 1. Research and Analysis Suite

**Overview:** A system that researches complex topics, analyzes findings, and produces comprehensive reports.

**Implementation:**

- **Research Agent:** Identifies key information sources and extracts relevant data
- **Analysis Agent:** Evaluates findings, identifies patterns, and draws preliminary conclusions
- **Fact-Checking Agent:** Verifies claims and ensures accuracy of information
- **Visualization Agent:** Creates charts and diagrams to illustrate key concepts
- **Report Agent:** Synthesizes everything into a well-structured final document

**Workflow:** The system can tackle research questions like market trends, competitive analysis, or academic literature reviews, with each agent handling its specialized portion while building on shared findings.

### 2. Content Creation Pipeline

**Overview:** A system for creating various forms of content from initial concept to final delivery.

**Implementation:**

- **Topic Research Agent:** Explores potential angles and gathers background information
- **Outline Agent:** Structures the content with logical flow and key points
- **Content Writer Agent:** Creates the main body of the content
- **Editor Agent:** Reviews and refines the content for quality and consistency
- **SEO Agent:** Optimizes content for search engines
- **Media Agent:** Suggests or creates complementary images, videos, or audio

**Workflow:** Perfect for blog networks, marketing agencies, or content platforms that need consistent output with specialized expertise at each stage.

### 3. Software Development Assistant

**Overview:** A collaborative coding system that helps with various stages of software development.

**Implementation:**

- **Requirements Agent:** Clarifies user requirements and creates specifications
- **Architecture Agent:** Designs software structure and component relationships
- **Implementation Agent:** Writes actual code according to specifications
- **Testing Agent:** Creates test cases and validation procedures
- **Documentation Agent:** Produces technical documentation and user guides
- **Security Agent:** Reviews for potential vulnerabilities

**Workflow:** The crew can take a project description and progressively build it out, with each agent handling its specialized domain while maintaining a cohesive development approach.

### 4. Educational Course Creator

**Overview:** A system for developing complete educational courses on specified topics.

**Implementation:**

- **Curriculum Agent:** Structures the overall learning path and objectives
- **Content Agent:** Creates the core instructional material
- **Exercise Agent:** Develops practice exercises and assignments
- **Assessment Agent:** Creates quizzes and tests to evaluate learning
- **Resource Agent:** Compiles supplementary materials and references
- **Pedagogy Agent:** Reviews materials for teaching effectiveness

**Workflow:** The system can create complete courses from basic outlines, with each agent focusing on a specific aspect of educational design.

### 5. Customer Service Intelligence

**Overview:** A system that analyzes customer interactions and creates responses and knowledge bases.

**Implementation:**

- **Classifier Agent:** Categorizes customer inquiries by type and urgency
- **Knowledge Agent:** Retrieves relevant information from company resources
- **Response Agent:** Crafts detailed, accurate responses
- **Empathy Agent:** Reviews responses for tone and customer satisfaction
- **FAQ Agent:** Identifies common questions and creates standardized answers
- **Analytics Agent:** Identifies trends and suggests service improvements

**Workflow:** The system can process customer inquiries, analyze patterns, and build an increasingly effective knowledge base while maintaining response quality.

### 6. Product Development Assistant

**Overview:** A system to help with ideation, design, and planning for new products.

**Implementation:**

- **Market Research Agent:** Analyzes market needs and competition
- **Ideation Agent:** Generates innovative product concepts
- **Design Agent:** Creates detailed product specifications
- **Feasibility Agent:** Evaluates technical and economic viability
- **Roadmap Agent:** Develops implementation phases and timelines
- **Pitch Agent:** Creates compelling presentations for stakeholders

**Workflow:** The crew collaborates to take product ideas from concept to detailed planning, each agent contributing specialized expertise to the overall development process.

Each of these scenarios demonstrates how TinyCrew's multi-agent approach with specialized roles and shared memory can tackle complex workflows more effectively than single-agent solutions. The framework's flexibility allows it to be adapted to many different domains where collaborative problem-solving adds significant value.