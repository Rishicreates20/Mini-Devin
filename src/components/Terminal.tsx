import React, { useEffect, useRef } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

interface TerminalProps {
  onInit?: (terminal: XTerm) => void;
}

export const Terminal: React.FC<TerminalProps> = ({ onInit }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new XTerm({
      theme: {
        background: '#151619',
        foreground: '#FFFFFF',
        cursor: '#F27D26',
      },
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 12,
      cursorBlink: true,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    
    // Use ResizeObserver for more robust fitting
    const resizeObserver = new ResizeObserver(() => {
      if (!terminalRef.current) return;
      
      // xterm-addon-fit will crash if dimensions are 0 or elements are hidden
      if (terminalRef.current.clientWidth === 0 || terminalRef.current.clientHeight === 0) {
        return;
      }

      // Defer the fit calculation to ensure DOM is fully painted
      requestAnimationFrame(() => {
        try {
          if (terminalRef.current && terminalRef.current.clientWidth > 0) {
            fitAddon.fit();
          }
        } catch (e) {
          // Ignore fit errors if terminal core isn't ready
          console.warn('Terminal fit failed:', e);
        }
      });
    });

    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    xtermRef.current = term;
    if (onInit) onInit(term);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
    };
  }, []);

  return (
    <div className="w-full h-full bg-[#151619] rounded-lg overflow-hidden border border-[#8E9299]/20">
      <div className="flex items-center gap-2 px-4 py-2 bg-[#1a1b1e] border-bottom border-[#8E9299]/10">
        <div className="w-3 h-3 rounded-full bg-[#FF4444]" />
        <div className="w-3 h-3 rounded-full bg-[#FFB86C]" />
        <div className="w-3 h-3 rounded-full bg-[#50FA7B]" />
        <span className="ml-2 text-[10px] font-mono text-[#8E9299] uppercase tracking-wider">Terminal Output</span>
      </div>
      <div ref={terminalRef} className="w-full h-[calc(100%-36px)] p-2" />
    </div>
  );
};
