# Mini Devin: Autonomous AI Coding Agent

Mini Devin is a sophisticated AI agent that can plan, write, execute, and debug code autonomously.

## Features

- **AI Task Planner**: Breaks down complex natural language prompts into structured development steps using Gemini 3.1 Pro.
- **Autonomous Code Generator**: Generates high-quality source code for each step of the plan.
- **Automated Unit Testing**: Automatically generates unit tests for every file created and executes them in the sandbox to verify correctness before proceeding.
- **Sandbox Execution**: Runs generated code in an isolated temporary environment.
- **Live Terminal**: Real-time streaming of execution logs via WebSockets and xterm.js.
- **Self-Debugging Loop**: Automatically detects runtime errors and uses AI to fix them.
- **Modern UI**: A "hardware-inspired" technical dashboard built with React and Tailwind CSS.

## Tech Stack

- **Frontend**: React 19, Vite, Tailwind CSS, Lucide React, Motion.
- **Backend**: Node.js, Express, Socket.io.
- **AI**: Google Gemini 3.1 Pro API.
- **Terminal**: xterm.js.

## How it Works

1. **Task Input**: Describe what you want to build (e.g., "Create a script that calculates Fibonacci numbers").
2. **Planning**: Gemini analyzes the task and creates a multi-step execution plan.
3. **Coding**: For each step, the agent generates the necessary files.
4. **Execution**: The backend writes the files to a sandbox and executes them.
5. **Debugging**: If an error occurs, the agent captures the output, analyzes it, and attempts to fix the code automatically.

## Environment Variables

- `GEMINI_API_KEY`: Required for AI reasoning and code generation.
- `APP_URL`: Used for internal routing and identification.
