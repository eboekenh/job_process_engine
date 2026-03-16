import React, { useState, useEffect, useRef } from 'react';
import {
  Upload,
  CheckCircle,
  Play,
  Download,
  AlertCircle,
  Loader2,
  BrainCircuit,
  FileSpreadsheet,
  Check,
  Sparkles,
  X,
  Trash2,
  Clipboard,
  Square,
  MessageSquare
} from 'lucide-react';

const copyToClipboard = (text) => {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-9999px';
  textArea.style.top = '0';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    document.execCommand('copy');
  } catch (err) {
    console.error('Fallback copy failed', err);
  }
  document.body.removeChild(textArea);
};

const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = (error) => reject(error);
  });

const parseCSV = (text) => {
  const cleanText = text.replace(/^\ufeff/, '').trim();
  if (!cleanText) return [];

  const firstLine = cleanText.split('\n')[0];
  const delimiter = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';

  const lines = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        currentField += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === delimiter) {
        currentRow.push(currentField.trim());
        currentField = '';
      } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
        if (char === '\r') i++;
        currentRow.push(currentField.trim());
        if (currentRow.some((c) => c !== '')) lines.push(currentRow);
        currentRow = [];
        currentField = '';
      } else if (char !== '\r') {
        currentField += char;
      }
    }
  }

  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((c) => c !== '')) lines.push(currentRow);
  }

  return lines;
};

const fetchWithBackoff = async (prompt, systemInstruction = '', fileData = null, retries = 5) => {
  const delays = [1000, 2000, 4000, 8000, 16000];

  for (let i = 0; i <= retries; i++) {
    try {
      const response = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, systemInstruction, fileData })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      return data.text || '';
    } catch (error) {
      if (i === retries) throw error;
      await new Promise((res) => setTimeout(res, delays[i]));
    }
  }

  return '';
};

const PROMPT_TEMPLATES = [
  {
    id: 'cover_letter',
    name: 'Cover Letter',
    template:
      'Write a professional, high-impact cover letter (max 300 words). Match my specific technical skills and projects from my CV with the job details provided. Write in the same language as the job posting.'
  },
  {
    id: 'fit',
    name: 'Match Score',
    template:
      'Analyze my profile against this job listing. Provide a Match Score (0-100%). List 3 matching strengths and 2 critical gaps based on my CV.'
  },
  {
    id: 'outreach',
    name: 'Recruiter Message',
    template:
      'Write a short (under 100 words) outreach message. Reference my most relevant project from my CV that relates to this job.'
  },
  {
    id: 'custom_manual',
    name: 'Custom Prompt',
    template:
      'Type your custom instructions here. The AI will receive your CV profile and the specific job row data as context automatically.'
  }
];

export default function App() {
  const [step, setStep] = useState(1);
  const [error, setError] = useState('');
  const [fileStats, setFileStats] = useState(null);
  const [jobUploadMode, setJobUploadMode] = useState('file');
  const [manualCsvText, setManualCsvText] = useState('');

  const [cvFile, setCvFile] = useState(null);
  const [profileSummary, setProfileSummary] = useState('');
  const [isAnalyzingCV, setIsAnalyzingCV] = useState(false);
  const [csvData, setCsvData] = useState([]);
  const [csvHeaders, setCsvHeaders] = useState([]);

  const [selectedPrompt, setSelectedPrompt] = useState(PROMPT_TEMPLATES[0].template);
  const [promptId, setPromptId] = useState(PROMPT_TEMPLATES[0].id);
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState([]);
  const [progress, setProgress] = useState(0);

  const stopFlag = useRef(false);

  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    script.async = true;
    document.head.appendChild(script);
  }, []);

  const handleManualCsvProcess = () => {
    if (!manualCsvText.trim()) return;
    const parsed = parseCSV(manualCsvText);

    if (parsed.length > 1) {
      const headers = parsed[0];
      const rows = parsed.slice(1).map((row) => {
        const obj = {};
        headers.forEach((h, i) => {
          obj[h] = row[i] || '';
        });
        return obj;
      });

      setCsvHeaders(headers);
      setCsvData(rows);
      setFileStats({ name: 'Manually Pasted Data', size: 'N/A', rows: rows.length });
      setError('');
    } else {
      setError("Text doesn't look like a valid CSV.");
    }
  };

  const processJobFile = async (file) => {
    if (!file) return;
    setError('');

    const fileName = file.name.toLowerCase();
    const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');
    const reader = new FileReader();

    if (isExcel && window.XLSX) {
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = window.XLSX.read(data, { type: 'array' });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const json = window.XLSX.utils.sheet_to_json(sheet, { header: 1 });

          if (json.length <= 1) {
            setError('Excel file has no data rows.');
            return;
          }

          const headers = json[0].map(String);
          const rows = json.slice(1).map((row) => {
            const obj = {};
            headers.forEach((h, i) => {
              obj[h] = row[i] || '';
            });
            return obj;
          });

          setCsvHeaders(headers);
          setCsvData(rows);
          setFileStats({ name: file.name, size: `${(file.size / 1024).toFixed(1)} KB`, rows: rows.length });
        } catch {
          setError('Error reading Excel file.');
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = (e) => {
        const parsed = parseCSV(e.target.result);

        if (parsed.length > 1) {
          const headers = parsed[0];
          const rows = parsed.slice(1).map((row) => {
            const obj = {};
            headers.forEach((h, i) => {
              obj[h] = row[i] || '';
            });
            return obj;
          });

          setCsvHeaders(headers);
          setCsvData(rows);
          setFileStats({ name: file.name, size: `${(file.size / 1024).toFixed(1)} KB`, rows: rows.length });
        } else {
          setError('File appears invalid or empty.');
        }
      };
      reader.readAsText(file);
    }
  };

  const handleCVUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const base64 = await fileToBase64(file);
      setCvFile({ name: file.name, mimeType: file.type, base64 });
      setError('');
    } catch {
      setError('Failed to load CV.');
    }

    e.target.value = '';
  };

  const analyzeCV = async () => {
    if (!cvFile) {
      setError('Upload CV first.');
      return;
    }

    setIsAnalyzingCV(true);
    setError('');

    try {
      const summary = await fetchWithBackoff('Extract skills, projects, and title from this CV.', 'Senior Recruiter AI', cvFile);
      setProfileSummary(summary);
      setStep(2);
    } catch {
      setError('AI failed to read CV.');
    } finally {
      setIsAnalyzingCV(false);
    }
  };

  const startAutomation = async () => {
    if (!profileSummary || csvData.length === 0) {
      setError('Analysis and Job list required.');
      return;
    }

    stopFlag.current = false;
    setIsRunning(true);
    setResults([]);
    setProgress(0);
    setStep(4);

    const tempResults = [];
    for (let i = 0; i < csvData.length; i++) {
      if (stopFlag.current) break;

      const prompt = `BACKGROUND:\n${profileSummary}\n\nJOB:\n${JSON.stringify(csvData[i])}\n\nTASK:\n${selectedPrompt}`;

      try {
        const res = await fetchWithBackoff(prompt, 'Career Automation Agent');
        tempResults.push({ job: csvData[i], response: res, status: 'success' });
      } catch {
        tempResults.push({ job: csvData[i], response: 'Error generating content.', status: 'error' });
      }

      setResults([...tempResults]);
      setProgress(Math.round(((i + 1) / csvData.length) * 100));
    }

    setIsRunning(false);
  };

  const stopAutomation = () => {
    stopFlag.current = true;
  };

  const exportResults = () => {
    const outputColumnName =
      promptId === 'cover_letter'
        ? 'AI_Cover_Letter'
        : promptId === 'fit'
          ? 'AI_Match_Score'
          : promptId === 'outreach'
            ? 'AI_Recruiter_Message'
            : 'AI_Custom_Output';

    const headers = [...csvHeaders, outputColumnName];
    const rows = results.map((r) => ({ ...r.job, [outputColumnName]: r.response }));

    const escape = (v) => `"${String(v || '').replace(/"/g, '""')}"`;

    const csvContent = `\uFEFF${[headers.map(escape).join(','), ...rows.map((row) => headers.map((h) => escape(row[h])).join(','))].join('\n')}`;

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Job_Automation_${promptId}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 font-sans text-slate-900 md:p-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-indigo-600 p-2.5 text-white shadow-lg">
              <BrainCircuit size={24} />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight">ApplyAuto</h1>
              <p className="text-[10px] font-bold uppercase leading-none tracking-widest text-slate-400">Job Process Engine</p>
            </div>
          </div>
          <div className="flex gap-4">
            {(cvFile || csvData.length > 0) && (
              <button
                onClick={() => {
                  setCvFile(null);
                  setCsvData([]);
                  setStep(1);
                  setProfileSummary('');
                  setFileStats(null);
                  setResults([]);
                }}
                className="flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1.5 text-[10px] font-black uppercase text-rose-500 transition-colors hover:text-rose-700"
              >
                <Trash2 size={12} /> Reset Session
              </button>
            )}
          </div>
        </header>

        {error && (
          <div className="animate-in slide-in-from-top-2 mb-6 flex items-center justify-between rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-700 shadow-sm">
            <div className="flex items-center gap-3 text-sm font-bold">
              <AlertCircle size={18} /> {error}
            </div>
            <button onClick={() => setError('')}>
              <X size={16} />
            </button>
          </div>
        )}

        <div className="mb-8 grid grid-cols-4 gap-2">
          {[
            { id: 1, label: 'Profile' },
            { id: 2, label: 'Jobs' },
            { id: 3, label: 'Task' },
            { id: 4, label: 'Run' }
          ].map((s) => (
            <button key={s.id} onClick={() => setStep(s.id)} className="group flex cursor-pointer flex-col items-center gap-2 transition-all">
              <div
                className={`h-1.5 w-full rounded-full transition-all ${
                  step === s.id ? 'bg-indigo-600 shadow-md shadow-indigo-200' : 'bg-slate-200 group-hover:bg-indigo-300'
                }`}
              />
              <span className={`text-[10px] font-black uppercase tracking-widest ${step === s.id ? 'text-indigo-600' : 'text-slate-400'}`}>
                {s.label}
              </span>
            </button>
          ))}
        </div>

        <div className="relative min-h-[420px] rounded-[2.5rem] border border-slate-200 bg-white p-6 shadow-sm md:p-10">
          {step === 1 && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <h2 className="mb-1 text-xl font-black">1. Your Profile</h2>
              <div
                className={`relative mb-8 flex flex-col items-center rounded-3xl border-2 border-dashed p-12 text-center transition-all group ${
                  cvFile ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50'
                }`}
              >
                <input type="file" className="absolute inset-0 z-20 cursor-pointer opacity-0" onChange={handleCVUpload} accept="*/*" />
                <div
                  className={`mb-4 rounded-full p-4 transition-colors ${
                    cvFile
                      ? 'bg-emerald-100 text-emerald-600'
                      : 'bg-slate-100 text-slate-400 group-hover:bg-indigo-50 group-hover:text-indigo-500'
                  }`}
                >
                  {cvFile ? <CheckCircle size={32} /> : <Upload size={32} />}
                </div>
                <p className={`text-sm font-bold ${cvFile ? 'text-emerald-800' : 'text-slate-700'}`}>
                  {cvFile ? cvFile.name : 'Tap to Select CV File'}
                </p>
              </div>
              <button
                onClick={analyzeCV}
                disabled={isAnalyzingCV || !cvFile}
                className={`flex w-full items-center justify-center gap-3 rounded-2xl py-5 text-sm font-black shadow-lg transition-all active:scale-[0.98] ${
                  isAnalyzingCV || !cvFile
                    ? 'cursor-not-allowed bg-slate-100 text-slate-300 shadow-none'
                    : 'bg-indigo-600 text-white shadow-indigo-100 hover:bg-indigo-700'
                }`}
              >
                {isAnalyzingCV ? <Loader2 className="animate-spin" size={20} /> : <Sparkles size={20} />}
                Analyze My Background
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <h2 className="mb-1 text-xl font-black text-slate-900">2. Job Inventory</h2>
              <div className="mb-6 flex rounded-xl bg-slate-100 p-1">
                <button
                  onClick={() => setJobUploadMode('file')}
                  className={`flex-1 rounded-lg py-2 text-[10px] font-black uppercase transition-all ${
                    jobUploadMode === 'file' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  File Picker
                </button>
                <button
                  onClick={() => setJobUploadMode('paste')}
                  className={`flex-1 rounded-lg py-2 text-[10px] font-black uppercase transition-all ${
                    jobUploadMode === 'paste' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Paste Text
                </button>
              </div>
              {jobUploadMode === 'file' ? (
                <div
                  className={`relative mb-8 flex min-h-[220px] flex-col items-center justify-center rounded-3xl border-2 border-dashed p-12 text-center transition-all group ${
                    fileStats ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="file"
                    className="absolute inset-0 z-20 cursor-pointer opacity-0"
                    onChange={(e) => processJobFile(e.target.files[0])}
                    accept="*/*"
                  />
                  <div
                    className={`mb-4 rounded-full p-4 transition-colors ${
                      fileStats
                        ? 'bg-emerald-100 text-emerald-600'
                        : 'bg-slate-100 text-slate-400 group-hover:bg-emerald-50 group-hover:text-emerald-500'
                    }`}
                  >
                    <FileSpreadsheet size={32} />
                  </div>
                  <p className={`text-sm font-bold ${fileStats ? 'text-emerald-800' : 'text-slate-700'}`}>
                    {fileStats ? fileStats.name : 'Tap to Select Job List'}
                  </p>
                </div>
              ) : (
                <div className="mb-8">
                  <textarea
                    className="mb-4 h-44 w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed shadow-inner outline-none transition-all focus:bg-white"
                    placeholder="Paste CSV text here..."
                    value={manualCsvText}
                    onChange={(e) => setManualCsvText(e.target.value)}
                  />
                  <button
                    onClick={handleManualCsvProcess}
                    className="w-full rounded-xl bg-slate-900 py-3 text-xs font-black text-white transition-all hover:bg-black"
                  >
                    Process Pasted Text
                  </button>
                </div>
              )}
              {fileStats && (
                <div className="animate-in zoom-in-95 mb-6 rounded-3xl border border-slate-100 bg-slate-50 p-6">
                  <div className="mb-6 flex items-center justify-between">
                    <div>
                      <span className="mb-1 block text-[10px] font-black uppercase leading-none tracking-widest text-slate-400">Data Map Detected</span>
                      <span className="text-lg font-black leading-none text-indigo-900">{fileStats.rows} Jobs Loaded</span>
                    </div>
                    <button onClick={() => setStep(3)} className="rounded-xl bg-indigo-600 px-6 py-2.5 text-xs font-black text-white shadow-md hover:bg-indigo-700">
                      Next Step →
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <h2 className="mb-2 text-xl font-black">3. Automation Goal</h2>
              <div className="mb-8 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
                {PROMPT_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setSelectedPrompt(t.template);
                      setPromptId(t.id);
                    }}
                    className={`rounded-2xl border-2 p-4 text-left transition-all ${
                      promptId === t.id ? 'scale-[1.02] border-indigo-600 bg-indigo-50 shadow-md' : 'border-slate-100 hover:border-indigo-100'
                    }`}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      {t.id === 'custom_manual' ? (
                        <MessageSquare size={14} className={promptId === t.id ? 'text-indigo-600' : 'text-slate-400'} />
                      ) : (
                        <Sparkles size={14} className={promptId === t.id ? 'text-indigo-600' : 'text-slate-400'} />
                      )}
                      <div className={`text-[10px] font-black uppercase tracking-wider ${promptId === t.id ? 'text-indigo-600' : 'text-slate-800'}`}>
                        {t.name}
                      </div>
                    </div>
                    <div className="line-clamp-2 text-[10px] leading-relaxed text-slate-400">{t.template}</div>
                  </button>
                ))}
              </div>

              <div className="mb-10">
                <label className="mb-2 block px-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Detailed Instructions</label>
                <textarea
                  className="h-36 w-full rounded-[2rem] border border-slate-200 bg-slate-50 p-5 text-xs leading-relaxed shadow-inner outline-none transition-all focus:bg-white focus:ring-4 focus:ring-indigo-50"
                  value={selectedPrompt}
                  onChange={(e) => {
                    setSelectedPrompt(e.target.value);
                    setPromptId('custom');
                  }}
                />
              </div>

              <button
                onClick={() => setStep(4)}
                className="mt-4 flex w-full items-center justify-center gap-3 rounded-2xl bg-indigo-600 py-5 text-sm font-black text-white shadow-xl shadow-indigo-100 transition-all hover:bg-indigo-700 active:scale-[0.98]"
              >
                Proceed to Run
              </button>
            </div>
          )}

          {step === 4 && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="mb-10 flex items-end justify-between">
                <div>
                  <h2 className="text-2xl font-black">4. Execution Hub</h2>
                  <p
                    className={`mt-1 text-[10px] font-black uppercase tracking-[0.2em] ${
                      isRunning ? 'animate-pulse text-indigo-600' : 'text-emerald-600'
                    }`}
                  >
                    {isRunning ? 'Synthesizing...' : results.length > 0 ? 'Queue Completed' : 'Awaiting Run Command'}
                  </p>
                </div>
                {!isRunning && results.length > 0 && (
                  <button
                    onClick={exportResults}
                    className="flex items-center gap-2 rounded-2xl bg-emerald-600 px-8 py-3.5 text-xs font-black text-white shadow-lg shadow-emerald-50 transition-all hover:bg-emerald-700 active:scale-95"
                  >
                    <Download size={16} /> Export Spreadsheet
                  </button>
                )}
              </div>

              <div className="mb-10 flex gap-4">
                {!isRunning ? (
                  <button
                    onClick={startAutomation}
                    disabled={!profileSummary || csvData.length === 0}
                    className={`flex-1 rounded-2xl py-5 text-sm font-black transition-all shadow-xl active:scale-[0.98] ${
                      !profileSummary || csvData.length === 0
                        ? 'cursor-not-allowed bg-slate-100 text-slate-300 shadow-none'
                        : 'bg-indigo-600 text-white shadow-indigo-100 hover:bg-indigo-700'
                    }`}
                  >
                    <span className="flex items-center justify-center gap-3">
                      <Play size={20} fill="currentColor" />
                      Launch Automation
                    </span>
                  </button>
                ) : (
                  <button
                    onClick={stopAutomation}
                    className="flex-1 rounded-2xl bg-rose-600 py-5 text-sm font-black text-white shadow-xl transition-all hover:bg-rose-700 active:scale-[0.98]"
                  >
                    <span className="flex items-center justify-center gap-3">
                      <Square size={20} fill="currentColor" />
                      Stop Process
                    </span>
                  </button>
                )}
              </div>

              {(isRunning || progress > 0) && (
                <div className="mb-12 px-2">
                  <div className="mb-3 flex justify-between text-[11px] font-black uppercase leading-none tracking-widest text-slate-400">
                    <span>
                      {results.length} / {csvData.length} Done
                    </span>
                    <span className="text-indigo-600">{progress}%</span>
                  </div>
                  <div className="h-4 w-full overflow-hidden rounded-full border border-slate-200 bg-slate-100 shadow-inner">
                    <div
                      className="h-full rounded-full bg-indigo-600 shadow-lg transition-all duration-700 ease-out"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4">
                {results.map((res, i) => (
                  <ResultRow key={i} res={res} />
                ))}

                {results.length === 0 && !isRunning && (
                  <div className="rounded-[3rem] border-2 border-dashed border-slate-200 bg-slate-50 py-24 text-center">
                    <Play size={48} className="mx-auto mb-4 text-slate-300 opacity-50" />
                    <p className="text-sm font-black uppercase tracking-widest text-slate-400">Ready to Begin</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultRow({ res }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    copyToClipboard(res.response);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group flex items-start gap-5 rounded-[2rem] border border-slate-100 bg-white p-6 shadow-sm transition-all hover:border-indigo-100">
      <div className={`mt-1.5 h-3 w-3 flex-shrink-0 rounded-full shadow-sm ${res.status === 'success' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex items-center justify-between">
          <div className="truncate pr-4 text-sm font-black text-slate-800">
            {res.job.title || res.job.Title || 'Entry'} - <span className="font-bold text-slate-400">{res.job.company || res.job.Company || 'N/A'}</span>
          </div>
          <button
            onClick={handleCopy}
            className={`flex items-center gap-1 text-[10px] font-black uppercase transition-all ${copied ? 'text-emerald-600' : 'text-slate-300 hover:text-indigo-600'}`}
          >
            {copied ? <Check size={12} /> : <Clipboard size={12} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div className="whitespace-pre-wrap rounded-[1.5rem] border border-slate-50 bg-slate-50 p-5 text-[11px] leading-relaxed text-slate-600 transition-colors group-hover:bg-white">
          {res.response}
        </div>
      </div>
    </div>
  );
}
