import { GoogleGenAI, Type } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error("GEMINI_API_KEY is not defined. Please set it in your environment or .env file.");
}

const ai = new GoogleGenAI({ apiKey: apiKey || "" });

export interface ModelParams {
  temperature?: number;
  topK?: number;
  topP?: number;
}

export interface Step {
  id: string;
  title: string;
  description: string;
  status: "pending" | "running" | "completed" | "failed";
}

export interface Plan {
  steps: Step[];
}

export async function generatePlan(task: string, params?: ModelParams): Promise<Plan> {
  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: `You are a software architect. Break down the following task into a sequence of actionable steps for an AI coding agent.
    Task: ${task}
    
    Return the plan as a JSON object with a 'steps' array. Each step should have 'id', 'title', and 'description'.`,
    config: {
      ...params,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          steps: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                title: { type: Type.STRING },
                description: { type: Type.STRING },
              },
              required: ["id", "title", "description"],
            },
          },
        },
        required: ["steps"],
      },
    },
  });

  return JSON.parse(response.text || "{}");
}

export async function generateCode(task: string, plan: Plan, currentStep: Step, files: Record<string, string>, params?: ModelParams): Promise<{ filename: string; content: string; explanation: string }> {
  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: `You are an expert software engineer. You are working on the following task: ${task}
    
    The overall plan is: ${JSON.stringify(plan.steps)}
    
    You are currently on step: ${currentStep.title} (${currentStep.description})
    
    Existing files: ${JSON.stringify(Object.keys(files))}
    
    Generate the code for the file required in this step. 
    Return a JSON object with 'filename', 'content', and 'explanation'.`,
    config: {
      ...params,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          filename: { type: Type.STRING },
          content: { type: Type.STRING },
          explanation: { type: Type.STRING },
        },
        required: ["filename", "content", "explanation"],
      },
    },
  });

  return JSON.parse(response.text || "{}");
}

export async function generateTests(task: string, filename: string, content: string, params?: ModelParams): Promise<{ testFilename: string; testContent: string; testCommand: string }> {
  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: `You are a QA engineer. Generate a unit test for the following code:
    
    File: ${filename}
    Code:
    ${content}
    
    The original task was: ${task}
    
    Generate a simple test script (e.g., using 'node:test' for JS or 'unittest' for Python).
    Return a JSON object with 'testFilename', 'testContent', and 'testCommand' (the command to run the test).`,
    config: {
      ...params,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          testFilename: { type: Type.STRING },
          testContent: { type: Type.STRING },
          testCommand: { type: Type.STRING },
        },
        required: ["testFilename", "testContent", "testCommand"],
      },
    },
  });

  return JSON.parse(response.text || "{}");
}

export async function debugCode(error: string, code: string, filename: string, params?: ModelParams): Promise<{ fixedCode: string; explanation: string }> {
  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: `The following code in file '${filename}' produced an error:
    
    Code:
    ${code}
    
    Error:
    ${error}
    
    Fix the code and provide an explanation. Return a JSON object with 'fixedCode' and 'explanation'.`,
    config: {
      ...params,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          fixedCode: { type: Type.STRING },
          explanation: { type: Type.STRING },
        },
        required: ["fixedCode", "explanation"],
      },
    },
  });

  return JSON.parse(response.text || "{}");
}
