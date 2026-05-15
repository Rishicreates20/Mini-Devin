import React from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Download } from 'lucide-react';

interface CodeViewerProps {
  filename: string;
  code: string;
}

export const CodeViewer: React.FC<CodeViewerProps> = ({ filename, code }) => {
  const language = filename.split('.').pop() || 'javascript';

  const downloadFile = () => {
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full hardware-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-[#1a1b1e] border-b border-[#8E9299]/10">
        <span className="text-xs font-mono text-[#8E9299]">{filename}</span>
        <div className="flex items-center gap-3">
          <button
            onClick={downloadFile}
            className="text-[#8E9299] hover:text-white transition-colors"
            title="Download file"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <div className="flex gap-1">
            <div className="w-2 h-2 rounded-full bg-[#8E9299]/20" />
            <div className="w-2 h-2 rounded-full bg-[#8E9299]/20" />
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-auto text-sm">
        <SyntaxHighlighter
          language={language}
          style={vscDarkPlus}
          customStyle={{
            margin: 0,
            padding: '1rem',
            background: 'transparent',
            height: '100%',
          }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
};
