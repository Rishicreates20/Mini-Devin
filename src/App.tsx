import React, { useState, useEffect, useRef } from 'react';
import { Terminal as XTerm } from 'xterm';
import { io, Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Play, 
  Terminal as TerminalIcon, 
  Code, 
  ListChecks, 
  AlertCircle, 
  CheckCircle2, 
  Loader2,
  Cpu,
  ChevronRight,
  FileCode,
  Bug,
  Github,
  ExternalLink,
  Check,
  Settings
} from 'lucide-react';
import { Terminal } from './components/Terminal';
import { CodeViewer } from './components/CodeViewer';
import { generatePlan, generateCode, generateTests, debugCode, Plan, Step, ModelParams } from './services/gemini';

export default function App() {
  const [task, setTask] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(-1);
  const [files, setFiles] = useState<Record<string, string>>({});
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [sandboxId, setSandboxId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [githubConnected, setGithubConnected] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [githubRepoUrl, setGithubRepoUrl] = useState<string | null>(null);
  
  const [showSettings, setShowSettings] = useState(false);
  const [modelParams, setModelParams] = useState<ModelParams>({
    temperature: 0.7,
    topK: 40,
    topP: 0.95,
  });

  const terminalRef = useRef<XTerm | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    socketRef.current = io();
    
    socketRef.current.on('output', ({ type, data }) => {
      if (terminalRef.current) {
        const color = type === 'stderr' ? '\x1b[31m' : type === 'system' ? '\x1b[36m' : '';
        const reset = '\x1b[0m';
        terminalRef.current.write(`${color}${data}${reset}`);
      }
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  useEffect(() => {
    const checkGithubStatus = async () => {
      try {
        const res = await fetch('/api/auth/github/status');
        const data = await res.json();
        setGithubConnected(data.connected);
      } catch (e) {
        console.error('Failed to check GitHub status', e);
      }
    };
    checkGithubStatus();

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GITHUB_AUTH_SUCCESS') {
        setGithubConnected(true);
        log('GitHub account connected successfully!', 'success');
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const connectGithub = async () => {
    try {
      const res = await fetch('/api/auth/github/url');
      const { url } = await res.json();
      window.open(url, 'github_auth', 'width=600,height=700');
    } catch (e) {
      log('Failed to initiate GitHub connection', 'error');
    }
  };

  const pushToGithub = async () => {
    if (!sandboxId || isPushing) return;
    const repoName = prompt('Enter repository name:', `mini-devin-${Date.now()}`);
    if (!repoName) return;

    setIsPushing(true);
    log(`Creating GitHub repository: ${repoName}...`, 'info');
    try {
      const res = await fetch('/api/github/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sandboxId, repoName })
      });
      const data = await res.json();
      if (data.success) {
        setGithubRepoUrl(data.url);
        log(`Successfully pushed to GitHub: ${data.url}`, 'success');
      } else {
        throw new Error(data.error);
      }
    } catch (e: any) {
      log(`GitHub Export Failed: ${e.message}`, 'error');
    } finally {
      setIsPushing(false);
    }
  };

  const log = (msg: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') => {
    if (!terminalRef.current) return;
    const colors = {
      info: '\x1b[36m',
      success: '\x1b[32m',
      error: '\x1b[31m',
      warning: '\x1b[33m',
    };
    terminalRef.current.write(`\r\n${colors[type]}[SYSTEM] ${msg}\x1b[0m\r\n`);
  };

  const runAgent = async () => {
    if (!task || isProcessing) return;
    
    setIsProcessing(true);
    setError(null);
    setPlan(null);
    setFiles({});
    setSelectedFile(null);
    setCurrentStepIndex(-1);
    
    try {
      // 1. Init Sandbox
      log('Initializing sandbox environment...', 'info');
      const initRes = await fetch('/api/sandbox/init', { method: 'POST' }).catch(() => {
        throw new Error('NETWORK_ERROR: Failed to connect to the backend server.');
      });
      
      if (!initRes.ok) {
        throw new Error(`SANDBOX_ERROR: Server returned ${initRes.status} while initializing sandbox.`);
      }
      
      const { id } = await initRes.json();
      setSandboxId(id);
      log(`Sandbox created: ${id}`, 'success');

      // 2. Generate Plan
      log('Analyzing task and generating plan...', 'info');
      const generatedPlan = await generatePlan(task, modelParams).catch((err) => {
        throw new Error(`AI_ERROR: Failed to generate plan. ${err.message}`);
      });
      setPlan(generatedPlan);
      log(`Plan generated with ${generatedPlan.steps.length} steps.`, 'success');

      let currentFiles: Record<string, string> = {};

      // 3. Execute Steps
      for (let i = 0; i < generatedPlan.steps.length; i++) {
        const step = generatedPlan.steps[i];
        setCurrentStepIndex(i);
        log(`Executing Step ${i + 1}: ${step.title}`, 'info');

        // Generate Code
        let { filename, content, explanation } = await generateCode(task, generatedPlan, step, currentFiles, modelParams).catch((err) => {
          throw new Error(`AI_ERROR: Failed to generate code for step "${step.title}". ${err.message}`);
        });
        log(`Generated ${filename}: ${explanation}`, 'info');
        
        // Write File
        const writeRes = await fetch('/api/sandbox/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, filename, content })
        }).catch(() => {
          throw new Error(`NETWORK_ERROR: Failed to write file ${filename} to sandbox.`);
        });

        if (!writeRes.ok) {
          throw new Error(`SANDBOX_ERROR: Failed to save ${filename} (Status: ${writeRes.status}).`);
        }
        
        currentFiles[filename] = content;
        setFiles({ ...currentFiles });
        setSelectedFile(filename);

        // Generate and Run Tests
        log(`Generating unit tests for ${filename}...`, 'info');
        try {
          const { testFilename, testContent, testCommand } = await generateTests(task, filename, content, modelParams);
          
          log(`Writing test file: ${testFilename}`, 'info');
          await fetch('/api/sandbox/write', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, filename: testFilename, content: testContent })
          });

          currentFiles[testFilename] = testContent;
          setFiles({ ...currentFiles });

          log(`Executing tests: ${testCommand}`, 'warning');
          const testExitCode = await new Promise<number>((resolve) => {
            const handleExit = ({ code }: { code: number }) => {
              socketRef.current?.off('exit', handleExit);
              resolve(code);
            };
            socketRef.current?.on('exit', handleExit);
            const [cmd, ...args] = testCommand.split(' ');
            socketRef.current?.emit('run', { id, command: cmd, args });
          });

          if (testExitCode === 0) {
            log(`Tests passed for ${filename}!`, 'success');
          } else {
            log(`Tests failed for ${filename}.`, 'error');
            // We could trigger debugging here too, but let's keep it simple for now
          }
        } catch (testErr: any) {
          log(`Failed to generate or run tests: ${testErr.message}`, 'warning');
        }

        // Run if it's a script
        if (filename.endsWith('.js') || filename.endsWith('.py')) {
          const command = filename.endsWith('.js') ? 'node' : 'python3';
          log(`Running script: ${filename}`, 'warning');
          
          let exitCode = await new Promise<number>((resolve) => {
            const handleExit = ({ code }: { code: number }) => {
              socketRef.current?.off('exit', handleExit);
              resolve(code);
            };
            socketRef.current?.on('exit', handleExit);
            socketRef.current?.emit('run', { id, command, args: [filename] });
          });

          let retryCount = 0;
          const maxRetries = 3;

          while (exitCode !== 0 && retryCount < maxRetries) {
            retryCount++;
            log(`Error detected in ${filename}. Starting debug loop (Attempt ${retryCount}/${maxRetries})...`, 'error');
            
            const debugRes = await debugCode("Process exited with non-zero code", content, filename, modelParams).catch((err) => {
              throw new Error(`AI_ERROR: Debugger failed to analyze error in ${filename}. ${err.message}`);
            });
            log(`Fixed code generated. Retrying...`, 'info');
            
            const rewriteRes = await fetch('/api/sandbox/write', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id, filename, content: debugRes.fixedCode })
            });

            if (!rewriteRes.ok) {
              throw new Error(`SANDBOX_ERROR: Failed to rewrite fixed code to ${filename}.`);
            }
            
            content = debugRes.fixedCode;
            currentFiles[filename] = debugRes.fixedCode;
            setFiles({ ...currentFiles });
            
            exitCode = await new Promise<number>((resolve) => {
              const handleExit = ({ code }: { code: number }) => {
                socketRef.current?.off('exit', handleExit);
                resolve(code);
              };
              socketRef.current?.on('exit', handleExit);
              socketRef.current?.emit('run', { id, command, args: [filename] });
            });
          }

          if (exitCode !== 0) {
            throw new Error(`Execution failed for ${filename} after ${maxRetries} debug attempts.`);
          }
        }
      }

      log('All steps completed successfully!', 'success');
    } catch (err: any) {
      console.error(err);
      let displayMessage = err.message;
      let errorType = 'Fatal Error';

      if (err.message.startsWith('NETWORK_ERROR:')) {
        errorType = 'Network Connection Failed';
        displayMessage = err.message.replace('NETWORK_ERROR: ', '');
      } else if (err.message.startsWith('AI_ERROR:')) {
        errorType = 'AI Intelligence Error';
        displayMessage = err.message.replace('AI_ERROR: ', '');
      } else if (err.message.startsWith('SANDBOX_ERROR:')) {
        errorType = 'Sandbox Environment Error';
        displayMessage = err.message.replace('SANDBOX_ERROR: ', '');
      }

      setError(`${errorType}: ${displayMessage}`);
      log(`${errorType}: ${displayMessage}`, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen p-6 lg:p-12 flex flex-col gap-8">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 bg-[#151619] rounded-lg">
              <Cpu className="w-6 h-6 text-[#F27D26]" />
            </div>
            <h1 className="text-3xl font-bold tracking-tighter uppercase">Mini Devin</h1>
          </div>
          <p className="text-sm text-[#8E9299] font-mono tracking-tight">AUTONOMOUS AI CODING AGENT v1.0.4</p>
        </div>
        
        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center justify-center p-2 border border-black/10 rounded-lg hover:bg-black/5 transition-all text-[#8E9299] hover:text-[#151619]"
            title="Model Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
          
          {githubConnected ? (
            <button
              onClick={pushToGithub}
              disabled={isPushing || !sandboxId}
              className="flex items-center gap-2 px-4 py-2 bg-[#151619] text-white rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-[#2a2b2e] disabled:opacity-50 transition-all"
            >
              {isPushing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Github className="w-3 h-3" />}
              {githubRepoUrl ? 'Exported' : 'Export to GitHub'}
            </button>
          ) : (
            <button
              onClick={connectGithub}
              className="flex items-center gap-2 px-4 py-2 border border-black/10 rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-black/5 transition-all"
            >
              <Github className="w-3 h-3" />
              Connect GitHub
            </button>
          )}
          <div className="flex flex-col items-end">
            <span className="text-[10px] font-mono text-[#8E9299] uppercase">Status</span>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isProcessing ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
              <span className="text-xs font-bold uppercase">{isProcessing ? 'Processing' : 'Ready'}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 flex flex-col gap-6"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Settings className="w-5 h-5 text-[#F27D26]" /> 
                  AI Model Settings
                </h2>
                <button 
                  onClick={() => setShowSettings(false)}
                  className="text-[#8E9299] hover:text-red-500"
                >
                  Close
                </button>
              </div>

              <div className="flex flex-col gap-4">
                {/* Temperature */}
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-[#151619] flex justify-between">
                    <span>Temperature</span>
                    <span className="text-[#8E9299]">{modelParams.temperature}</span>
                  </label>
                  <input 
                    type="range" 
                    min="0" max="2" step="0.1" 
                    value={modelParams.temperature} 
                    onChange={e => setModelParams({...modelParams, temperature: parseFloat(e.target.value)})}
                    className="w-full accent-[#F27D26]"
                  />
                  <p className="text-[10px] text-[#8E9299]">Controls randomness. Lower is more deterministic, higher is more creative.</p>
                </div>

                {/* Top K */}
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-[#151619] flex justify-between">
                    <span>Top K</span>
                    <span className="text-[#8E9299]">{modelParams.topK}</span>
                  </label>
                  <input 
                    type="range" 
                    min="1" max="100" step="1" 
                    value={modelParams.topK} 
                    onChange={e => setModelParams({...modelParams, topK: parseInt(e.target.value)})}
                    className="w-full accent-[#F27D26]"
                  />
                  <p className="text-[10px] text-[#8E9299]">Limits the vocabulary to the top K most likely tokens.</p>
                </div>

                {/* Top P */}
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-[#151619] flex justify-between">
                    <span>Top P</span>
                    <span className="text-[#8E9299]">{modelParams.topP}</span>
                  </label>
                  <input 
                    type="range" 
                    min="0" max="1" step="0.05" 
                    value={modelParams.topP} 
                    onChange={e => setModelParams({...modelParams, topP: parseFloat(e.target.value)})}
                    className="w-full accent-[#F27D26]"
                  />
                  <p className="text-[10px] text-[#8E9299]">Limits the vocabulary to tokens cumulatively summing to P probability.</p>
                </div>
              </div>

              <div className="flex justify-end pt-4 border-t border-black/5">
                <button
                  onClick={() => setShowSettings(false)}
                  className="px-4 py-2 bg-[#151619] text-white rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-[#2a2b2e]"
                >
                  Done
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* GitHub Success Banner */}
      <AnimatePresence>
        {githubRepoUrl && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Check className="w-5 h-5 text-emerald-500" />
                <div>
                  <h3 className="text-sm font-bold text-emerald-800 uppercase tracking-wider">Repository Created</h3>
                  <p className="text-sm text-emerald-700">Your code has been successfully pushed to GitHub.</p>
                </div>
              </div>
              <a 
                href={githubRepoUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-emerald-700 transition-all"
              >
                View on GitHub <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error Banner */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-sm font-bold text-red-800 uppercase tracking-wider mb-1">Execution Halted</h3>
                <p className="text-sm text-red-700 leading-relaxed">{error}</p>
              </div>
              <button 
                onClick={() => setError(null)}
                className="text-red-400 hover:text-red-600 transition-colors"
              >
                <AlertCircle className="w-4 h-4 rotate-45" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Input & Plan */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          {/* Task Input */}
          <section className="glass-panel p-6 rounded-2xl shadow-sm">
            <h2 className="text-xs font-bold uppercase tracking-widest text-[#8E9299] mb-4 flex items-center gap-2">
              <TerminalIcon className="w-4 h-4" /> New Task
            </h2>
            <div className="flex flex-col gap-4">
              <textarea
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder="Describe the software task you want me to build..."
                className="w-full h-32 p-4 bg-white/50 border border-black/5 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#F27D26]/20 transition-all resize-none font-sans text-sm"
                disabled={isProcessing}
              />
              <button
                onClick={runAgent}
                disabled={isProcessing || !task}
                className="w-full py-4 bg-[#151619] text-white rounded-xl font-bold uppercase tracking-widest text-xs flex items-center justify-center gap-2 hover:bg-[#2a2b2e] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                {isProcessing ? 'Executing Agent' : 'Start Agent'}
              </button>
            </div>
          </section>

          {/* Plan Steps */}
          <section className="flex-1 glass-panel p-6 rounded-2xl shadow-sm overflow-hidden flex flex-col">
            <h2 className="text-xs font-bold uppercase tracking-widest text-[#8E9299] mb-4 flex items-center gap-2">
              <ListChecks className="w-4 h-4" /> Execution Plan
            </h2>
            <div className="flex-1 overflow-y-auto pr-2 space-y-3">
              <AnimatePresence mode="popLayout">
                {plan ? (
                  plan.steps.map((step, idx) => (
                    <motion.div
                      key={step.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.1 }}
                      className={`p-4 rounded-xl border transition-all ${
                        idx === currentStepIndex 
                          ? 'bg-[#151619] text-white border-transparent shadow-lg' 
                          : idx < currentStepIndex 
                          ? 'bg-emerald-50 border-emerald-100' 
                          : 'bg-white border-black/5'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                              idx === currentStepIndex ? 'bg-[#F27D26] text-white' : 'bg-black/5 text-[#8E9299]'
                            }`}>
                              0{idx + 1}
                            </span>
                            <h3 className="text-sm font-bold leading-tight">{step.title}</h3>
                          </div>
                          <p className={`text-xs leading-relaxed ${idx === currentStepIndex ? 'text-white/70' : 'text-[#8E9299]'}`}>
                            {step.description}
                          </p>
                        </div>
                        {idx < currentStepIndex && <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
                        {idx === currentStepIndex && <Loader2 className="w-4 h-4 text-[#F27D26] animate-spin flex-shrink-0" />}
                      </div>
                    </motion.div>
                  ))
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-30">
                    <ListChecks className="w-12 h-12 mb-4" />
                    <p className="text-sm font-medium">No active plan.<br/>Describe a task to begin.</p>
                  </div>
                )}
              </AnimatePresence>
            </div>
          </section>
        </div>

        {/* Right Column: Code & Terminal */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          {/* Top Row: Files & Code */}
          <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-6 min-h-[400px]">
            {/* File Explorer */}
            <div className="md:col-span-3 glass-panel p-4 rounded-2xl shadow-sm flex flex-col">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-[#8E9299] mb-4 flex items-center gap-2">
                <FileCode className="w-3 h-3" /> Workspace
              </h2>
              <div className="space-y-1 overflow-y-auto">
                {Object.keys(files).length > 0 ? (
                  Object.keys(files).map((filename) => (
                    <button
                      key={filename}
                      onClick={() => setSelectedFile(filename)}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                        selectedFile === filename 
                          ? 'bg-[#151619] text-white' 
                          : 'hover:bg-black/5 text-[#151619]'
                      }`}
                    >
                      <Code className="w-3 h-3 opacity-50" />
                      <span className="truncate">{filename}</span>
                    </button>
                  ))
                ) : (
                  <p className="text-[10px] text-[#8E9299] italic p-2">No files generated yet.</p>
                )}
              </div>
            </div>

            {/* Code Viewer */}
            <div className="md:col-span-9">
              {selectedFile ? (
                <CodeViewer filename={selectedFile} code={files[selectedFile]} />
              ) : (
                <div className="h-full hardware-card flex flex-col items-center justify-center opacity-20">
                  <Code className="w-16 h-16 mb-4" />
                  <p className="text-sm font-mono uppercase tracking-widest">Source Code Preview</p>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Row: Terminal */}
          <div className="h-64">
            <Terminal onInit={(term) => terminalRef.current = term} />
          </div>
        </div>
      </main>

      {/* Footer / Status Bar */}
      <footer className="glass-panel px-6 py-3 rounded-xl flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Engine: Gemini 3.1 Pro</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Sandbox: Node.js/Python3</span>
          </div>
        </div>
        <div className="text-[10px] font-mono text-[#8E9299]">
          {sandboxId ? `SESSION_ID: ${sandboxId.slice(0, 8)}...` : 'NO ACTIVE SESSION'}
        </div>
      </footer>
    </div>
  );
}
