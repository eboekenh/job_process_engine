# 🚀 ApplyAuto — AI Job Application Automation Engine

A full-stack application that uses Google's Gemini AI to automate job application tasks: CV analysis, job matching, cover letter generation, match scoring, and recruiter outreach messages.

![React](https://img.shields.io/badge/React-18-blue)
![Node.js](https://img.shields.io/badge/Node.js-Express_5-green)
![Gemini](https://img.shields.io/badge/AI-Gemini_API-purple)
![License](https://img.shields.io/badge/License-MIT-green)

## Features

- **AI CV Analysis** — Upload any format CV; Gemini extracts skills, experience, and project highlights into a structured profile
- **Batch Job Processing** — Upload job listings as CSV/Excel or paste directly; process multiple jobs in one run
- **Cover Letter Generation** — AI-generated, personalized cover letters tailored to each job description
- **Match Scoring** — AI evaluates fit between your profile and each job with detailed reasoning
- **Recruiter Messages** — Professional outreach messages customized per position
- **Custom Prompts** — Define your own AI automation task for each job
- **Export to CSV** — Download all results as UTF-8 CSV with BOM for Excel compatibility

## Architecture

```
┌─────────────────────────────┐
│    React Frontend (Vite)    │
│  4-Step Wizard UI + Export  │
└──────────┬──────────────────┘
           │ HTTP POST
┌──────────▼──────────────────┐
│  Express Backend (Proxy)    │
│  API key protection         │
│  Exponential backoff        │
│  Localhost-only validation  │
└──────────┬──────────────────┘
           │ REST API
┌──────────▼──────────────────┐
│  Google Gemini API          │
│  gemini-2.5-flash           │
└─────────────────────────────┘
```

## Tech Stack

- **Frontend:** React 18, Vite, CSS
- **Backend:** Node.js, Express 5
- **AI:** Google Gemini API (gemini-2.5-flash)
- **File Parsing:** Custom CSV parser + SheetJS (Excel)
- **Resilience:** Exponential backoff with 5 retries

## Getting Started

```bash
git clone https://github.com/eboekenh/job_process_engine.git
cd job_process_engine
npm install
```

### API Key Setup
```bash
cp .env.example .env
```
Add your Gemini API key to `.env`:
```
GEMINI_API_KEY=your_gemini_api_key_here
```

### Run
```bash
npm run dev
```
This starts both the React frontend and Express backend proxy concurrently.

## Workflow

1. **Upload CV** → Gemini extracts your professional profile
2. **Upload Jobs** → CSV/Excel with job listings (company, title, description)
3. **Choose Action** → Cover Letter / Match Score / Recruiter Message / Custom
4. **Process** → AI generates output for each job with real-time progress
5. **Export** → Download results as CSV

## Security

- API key is server-side only (never exposed to browser)
- Express proxy validates localhost-only origins
- No data persistence — everything stays in your session

## License

MIT
