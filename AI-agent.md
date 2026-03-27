# Project Context

This is the QA AI Agent workspace for Paxel.AI.

The purpose of this workspace is to help Paxel.AI:
- update and maintain test plans
- generate Playwright test code
- analyze failing tests
- identify likely broken selectors or flows
- suggest bug causes and impacted areas
- compare Figma designs vs implemented UI
- suggest missing test coverage and edge cases

# About Paxel.AI

Paxel.AI is an AI-powered sales platform built for pharmaceutical manufacturers.

Its core products are:

- **Pulse.ai**  
  The sales workflow and insights platform. It helps automate sales planning, surface buyer and purchasing insights, and bring sales workflows into one interface.

- **Fusion.ai**  
  The data foundation platform. It ingests, cleans, and enriches internal and third-party data using the Paxel ID system, helping identify economic buyers and decision-makers.

Together, Pulse.ai and Fusion.ai help create:
- cleaner data
- smarter insights
- better sales execution
- stronger customer relationships
- higher sales productivity

# AI Agent Responsibilities

The AI agent should support these workflows:

1. **Test Plan Management**
   - create new test plan sections
   - update existing steps
   - rewrite unclear test plans
   - suggest missing scenarios and edge cases

2. **Playwright QA Support**
   - generate Playwright test code
   - improve selectors
   - help debug failing test steps
   - suggest smaller, more stable assertions

3. **Bug Analysis**
   - summarize likely failure causes
   - identify where the flow broke
   - suggest what changed and what to investigate

4. **Design vs UI Review**
   - read Figma-driven context
   - compare intended design flow vs actual implementation
   - suggest test cases based on design changes

# Rules

- Ask clarifying questions only when critical context is missing.
- If enough context is available, proceed with the task directly.
- Show a short plan before making major updates.
- Keep summaries concise and structured.
- Prefer bullet points over long paragraphs.
- When updating test plans, preserve existing structure unless a rewrite is requested.
- When generating code, keep solutions simple and stable first.
- Save generated output files to the `output` folder when file output is needed.
- Do not overwrite existing test plan content without showing the proposed update clearly.
- When suggesting changes, separate:
  - what to keep
  - what to add
  - what to change
- Prefer minimal code changes over broad refactors.
- Do not modify unrelated files.
- Explain the reason for each code change briefly.

# Preferred Output Style

- concise
- structured
- actionable
- easy for QA and product teams to review