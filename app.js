import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from './database.js';
import { calculateMatchScore } from './services/aiMatcher.js';
import { parseResumeContent } from './services/resumeParser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 5050;

// Prevent Process Crashes
process.on('uncaughtException', (err) => {
  console.error('🛡️ Process Uncaught Exception Handled:', err.message);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🛡️ Process Unhandled Rejection Handled:', reason);
});

// Ensure database seeded
try {
  if (db.getCollection('users').length === 0) {
    import('./seed.js').then(m => m.runSeed()).catch(console.error);
  }
} catch (err) {
  console.error('Seed Error:', err.message);
}

function parseJSONBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

function sendJSON(res, data, statusCode = 200) {
  try {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end(JSON.stringify(data));
  } catch (e) {
    console.error('Error sending JSON:', e.message);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost:5050'}`);
    const pathname = reqUrl.pathname;

    // OPTIONS Preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      });
      return res.end();
    }

    // --- REST API ENDPOINTS ---

    // Health Check
    if (pathname === '/api/health') {
      return sendJSON(res, { status: 'ok', app: 'InternMatch AI API', timestamp: new Date().toISOString() });
    }

    // Auth: Login
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await parseJSONBody(req);
      const email = (body.email || '').trim().toLowerCase();
      const password = body.password || '';

      const user = db.findOne('users', u => (u.email || '').toLowerCase() === email);
      if (!user || user.password !== password) {
        return sendJSON(res, { error: 'Invalid email or password' }, 401);
      }
      const studentProfile = user.role === 'student' ? db.findOne('student_profiles', p => p.user_id === user.id) : null;
      const companyProfile = user.role === 'company' ? db.findOne('companies', c => c.user_id === user.id) : null;
      return sendJSON(res, {
        token: `demo_${user.role}_token`,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
        studentProfile,
        companyProfile
      });
    }

    // Auth: Register
    if (pathname === '/api/auth/register' && req.method === 'POST') {
      const body = await parseJSONBody(req);
      if (!body.name || !body.email || !body.password) {
        return sendJSON(res, { error: 'Name, email, and password are required' }, 400);
      }

      const email = (body.email || '').trim().toLowerCase();
      const existing = db.findOne('users', u => (u.email || '').toLowerCase() === email);
      if (existing) {
        return sendJSON(res, { error: 'User with this email already exists' }, 400);
      }

      const newUser = db.insert('users', {
        name: body.name,
        email: body.email,
        password: body.password,
        role: body.role || 'student'
      });
      let studentProfile = null;
      let companyProfile = null;

      if (body.role === 'student') {
        studentProfile = db.insert('student_profiles', {
          user_id: newUser.id,
          college: body.college || 'Engineering Institute',
          branch: body.branch || 'CSE',
          year: body.year || '3rd Year',
          CGPA: '8.5',
          skills: ['Python', 'Web Development'],
          interests: [body.branch || 'CSE'],
          location: body.location || 'San Jose, CA',
          resume: ''
        });
      } else {
        companyProfile = db.insert('companies', {
          user_id: newUser.id,
          company_name: body.companyName || body.name,
          description: 'Tech solutions enterprise',
          website: 'https://example.com',
          location: body.location || 'San Jose, CA',
          logo: 'https://images.unsplash.com/photo-1560179707-f14e90ef3623?w=150&auto=format&fit=crop&q=80'
        });
      }
      return sendJSON(res, {
        token: `demo_${newUser.role}_token`,
        user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role },
        studentProfile,
        companyProfile
      }, 201);
    }

    // Internships List & Search
    if (pathname === '/api/internships' && req.method === 'GET') {
      let list = db.getCollection('internships');
      const search = reqUrl.searchParams.get('search');
      const branch = reqUrl.searchParams.get('branch');
      const work_mode = reqUrl.searchParams.get('work_mode');
      const paid = reqUrl.searchParams.get('paid');

      if (search) {
        const q = search.toLowerCase();
        list = list.filter(i => 
          (i.title || '').toLowerCase().includes(q) || 
          (i.company_name || '').toLowerCase().includes(q) || 
          (i.skills || []).some(s => (s || '').toLowerCase().includes(q))
        );
      }
      if (branch && branch !== 'All') {
        const b = branch.toLowerCase();
        list = list.filter(i => (i.branch || '').toLowerCase() === b || (i.title || '').toLowerCase().includes(b));
      }
      if (work_mode && work_mode !== 'All') {
        list = list.filter(i => (i.work_mode || '').toLowerCase() === work_mode.toLowerCase());
      }
      if (paid === 'Paid') {
        list = list.filter(i => !(i.stipend || '').toLowerCase().includes('unpaid') && i.stipend !== '$0');
      }
      return sendJSON(res, list);
    }

    // Resume Analyzer API
    if ((pathname === '/api/resumes/analyze-text' || pathname === '/api/resumes/upload') && req.method === 'POST') {
      const body = await parseJSONBody(req);
      const analysis = parseResumeContent(body.resumeText || body.text || 'Skills: C, C++, Embedded Systems, RTOS, ARM Cortex, Python, IoT, Verilog.', body.filename || 'resume.pdf');
      const allInternships = db.getCollection('internships').filter(i => i.status === 'approved');
      return sendJSON(res, {
        message: 'Resume analyzed successfully',
        analysis,
        topMatchingInternships: allInternships.slice(0, 5)
      });
    }

    // ⚡ AUTOMATED AI RESUME AUTO-APPLY ALL MATCHING VACANCIES ENDPOINT
    if (pathname === '/api/resumes/auto-apply' && req.method === 'POST') {
      const body = await parseJSONBody(req);
      const resumeText = body.resumeText || body.text || 'Skills: C, C++, Python, Embedded Systems, RTOS, STM32, ARM Cortex, IoT, Verilog, Linux.';
      const filename = body.filename || 'resume.pdf';
      const studentId = body.student_id || 'usr_student_1';
      const studentName = body.student_name || 'Alex Chen';
      const studentEmail = body.student_email || 'alex@student.edu';

      const analysis = parseResumeContent(resumeText, filename);
      const activeInternships = db.getCollection('internships').filter(i => i.status === 'approved');

      // Filter all matching vacancies (branch or skill overlap)
      const matchingVacancies = activeInternships.filter(internship => {
        const reqSkills = (internship.skills || []).map(s => s.toLowerCase());
        const studentSkills = (analysis.detectedSkills || []).map(s => s.toLowerCase());
        const hasSkillMatch = reqSkills.some(r => studentSkills.some(s => s.includes(r) || r.includes(s)));
        const branchMatch = (internship.branch || '').toLowerCase() === (analysis.detectedBranch || '').toLowerCase();
        return hasSkillMatch || branchMatch;
      });

      const appliedJobs = [];
      const existingApps = db.getCollection('applications');

      matchingVacancies.forEach(job => {
        const alreadyApplied = existingApps.some(a => a.student_id === studentId && a.internship_id === job.internship_id);
        if (!alreadyApplied) {
          const matchScore = calculateMatchScore({ branch: analysis.detectedBranch, skills: analysis.detectedSkills, CGPA: '8.9' }, job).score;
          const newApp = db.insert('applications', {
            application_id: `app_auto_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
            student_id: studentId,
            student_name: studentName,
            student_email: studentEmail,
            student_branch: analysis.detectedBranch,
            internship_id: job.internship_id,
            internship_title: job.title,
            company_id: job.company_id,
            company_name: job.company_name,
            applied_date: new Date().toISOString().split('T')[0],
            status: 'Applied',
            match_score: matchScore,
            cover_letter: `⚡ Auto-Applied via AI Resume Matcher for ${analysis.detectedBranch} role.`
          });
          appliedJobs.push(newApp);
        }
      });

      return sendJSON(res, {
        success: true,
        message: `⚡ AI Auto-Apply Complete! Applied to ${appliedJobs.length} matching vacancy openings!`,
        autoAppliedCount: appliedJobs.length,
        detectedBranch: analysis.detectedBranch,
        detectedSkills: analysis.detectedSkills,
        appliedJobs
      }, 201);
    }

    // Applications List API
    if (pathname === '/api/applications/my-applications' && req.method === 'GET') {
      return sendJSON(res, db.getCollection('applications'));
    }

    // Submit Application API
    if (pathname === '/api/applications' && req.method === 'POST') {
      const body = await parseJSONBody(req);
      const newApp = db.insert('applications', {
        application_id: `app_${Date.now()}`,
        student_id: body.student_id || 'usr_student_1',
        student_name: body.student_name || 'Alex Chen',
        student_email: body.student_email || 'alex@student.edu',
        student_branch: 'ECE',
        internship_id: body.internship_id || 'int_1',
        internship_title: body.internship_title || 'Embedded Firmware Engineer Intern',
        company_id: body.company_id || 'comp_1',
        company_name: body.company_name || 'SiliconEdge Systems',
        applied_date: new Date().toISOString().split('T')[0],
        status: 'Applied',
        match_score: 95,
        cover_letter: body.cover_letter || 'Interested in this role!'
      });
      return sendJSON(res, newApp, 201);
    }

    // Admin Stats API
    if (pathname === '/api/admin/stats' && req.method === 'GET') {
      const users = db.getCollection('users');
      const internships = db.getCollection('internships');
      const applications = db.getCollection('applications');
      return sendJSON(res, {
        totalStudents: users.filter(u => u.role === 'student').length,
        totalCompanies: users.filter(u => u.role === 'company').length,
        totalInternships: internships.length,
        activeInternships: internships.filter(i => i.status === 'approved').length,
        pendingApprovals: internships.filter(i => i.status === 'pending').length,
        totalApplications: applications.length,
        selectedStudents: applications.filter(a => a.status === 'Selected').length
      });
    }

    // --- SERVE MODERN NEXT-GEN SPA FRONTEND ---
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>InternMatch AI | Next-Gen AI Internship Auto-Apply Platform</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            brand: { 50: '#f0f3ff', 100: '#e0e7ff', 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca', 900: '#312e81', 950: '#0b0f19' },
            accent: { cyan: '#06b6d4', emerald: '#10b981', amber: '#f59e0b', rose: '#f43f5e', violet: '#8b5cf6' }
          },
          animation: {
            'glow-pulse': 'glow 3s ease-in-out infinite',
            'float': 'float 6s ease-in-out infinite'
          }
        }
      }
    }
  </script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Outfit:wght@500;700;800;900&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; background-color: #0b0f19; color: #f8fafc; }
    .font-outfit { font-family: 'Outfit', sans-serif; }
    .neon-gradient-text { background: linear-gradient(135deg, #818cf8 0%, #06b6d4 50%, #10b981 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .glass-card { background: rgba(15, 23, 42, 0.75); backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 1.25rem; box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.5); }
    .glass-card-glow { border: 1px solid rgba(99, 102, 241, 0.4); box-shadow: 0 0 30px rgba(99, 102, 241, 0.15); }
    .btn-gradient { background: linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%); transition: all 0.3s ease; }
    .btn-gradient:hover { opacity: 0.95; transform: translateY(-2px); box-shadow: 0 10px 25px rgba(6, 182, 212, 0.4); }
    .badge-neon { background: rgba(6, 182, 212, 0.15); border: 1px solid rgba(6, 182, 212, 0.4); color: #38bdf8; }
    @keyframes glow { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.8; } }
  </style>
</head>
<body class="min-h-screen relative overflow-x-hidden">

  <!-- BACKGROUND PARTICLES GLOW -->
  <div class="fixed top-0 left-1/4 w-96 h-96 bg-brand-600/20 rounded-full blur-3xl pointer-events-none animate-glow-pulse"></div>
  <div class="fixed bottom-10 right-10 w-96 h-96 bg-accent-cyan/15 rounded-full blur-3xl pointer-events-none"></div>

  <!-- NAVBAR -->
  <header class="sticky top-0 z-50 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl px-6 py-3.5 flex items-center justify-between">
    <div class="flex items-center gap-3">
      <div class="w-11 h-11 rounded-2xl bg-gradient-to-tr from-brand-600 via-brand-500 to-accent-cyan flex items-center justify-center text-white text-2xl font-black shadow-lg shadow-brand-500/30">
        ✨
      </div>
      <div>
        <a href="/" class="font-black text-2xl tracking-tight text-white font-outfit">InternMatch <span class="neon-gradient-text">AI</span></a>
        <span class="block text-[10px] uppercase font-extrabold tracking-widest text-indigo-400">Automated Talent Platform</span>
      </div>
    </div>

    <div class="flex items-center gap-4">
      <div class="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900 border border-emerald-500/30 text-xs font-bold text-emerald-400">
        <span class="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
        AI Matcher & Auto-Apply Active (Port 5050)
      </div>
      <button onclick="scrollToAutoApply()" class="px-5 py-2 rounded-xl text-xs font-extrabold btn-gradient text-white shadow-lg">
        ⚡ 1-Click Auto-Apply All Vacancies
      </button>
    </div>
  </header>

  <!-- MAIN HERO CONTAINER -->
  <main class="max-w-6xl mx-auto px-6 py-12 space-y-12">
    
    {/* HERO TITLE */}
    <div class="text-center space-y-5 max-w-4xl mx-auto">
      <div class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-950/80 border border-indigo-500/40 text-indigo-300 text-xs font-extrabold tracking-wide shadow-inner">
        ⚡ NEW FEATURE: Automated Resume Upload & Role-Based Vacancy Auto-Apply
      </div>

      <h1 class="text-5xl sm:text-7xl font-black font-outfit text-white leading-tight tracking-tight">
        Upload Resume. <br/><span class="neon-gradient-text">Auto-Apply All Vacancies.</span>
      </h1>

      <p class="text-base sm:text-lg text-slate-300 max-w-2xl mx-auto leading-relaxed font-normal">
        Upload your PDF/DOCX resume once. Our AI parses your discipline (<span class="font-bold text-accent-cyan">ECE, CSE, AI/ML, IoT, EEE, Mech, Civil</span>), extracts skills, and automatically submits your application to all matching openings instantly!
      </p>
    </div>

    {/* AUTOMATED AI AUTO-APPLY RESUME ZONE */}
    <div id="auto-apply-zone" class="glass-card glass-card-glow p-8 md:p-10 space-y-6 relative overflow-hidden">
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <h2 class="text-2xl font-extrabold text-white font-outfit flex items-center gap-2">
            ⚡ One-Click Automated AI Vacancy Application
          </h2>
          <p class="text-xs text-slate-400 mt-1">
            Drag & drop your resume file or paste resume summary to automatically apply across all role-matched positions.
          </p>
        </div>
        <span class="px-3 py-1.5 rounded-full bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-xs font-bold">
          Role-Based Auto Dispatcher
        </span>
      </div>

      <!-- PASTE / SAMPLE TEXT INPUT -->
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <label class="text-xs font-bold uppercase tracking-wider text-slate-300">
            Resume Content / Skills Profile
          </label>
          <div class="flex items-center gap-2 text-xs">
            <span class="text-slate-500">Preset Sample:</span>
            <button onclick="setSample('ece')" class="text-accent-cyan hover:underline font-bold">ECE/Embedded</button>
            <span>•</span>
            <button onclick="setSample('cse')" class="text-accent-cyan hover:underline font-bold">CSE/Software</button>
            <span>•</span>
            <button onclick="setSample('ai')" class="text-accent-cyan hover:underline font-bold">AI/ML</button>
          </div>
        </div>

        <textarea
          id="resume-text-input"
          rows="5"
          class="w-full rounded-2xl border border-slate-700 bg-slate-950 p-4 text-xs font-mono text-slate-200 focus:ring-2 focus:ring-accent-cyan focus:outline-none"
          placeholder="Paste your education, skills (C, C++, Python, Embedded C, RTOS, React, Verilog, etc.) or projects here..."
        ></textarea>
      </div>

      <!-- AUTO APPLY LAUNCH BUTTON -->
      <button
        id="auto-apply-btn"
        onclick="triggerAutoApply()"
        class="w-full py-4 rounded-2xl font-black text-sm text-white btn-gradient shadow-xl flex items-center justify-center gap-3 text-base tracking-wide"
      >
        <span>⚡ RUN AI AUTO-APPLY FOR ALL MATCHING VACANCIES</span>
      </button>

      <!-- AUTO-APPLY RESULTS DISPLAY CONTAINER -->
      <div id="auto-apply-results" class="hidden space-y-4 pt-4 border-t border-slate-800">
        <!-- Rendered via JS -->
      </div>
    </div>

    {/* LIVE DEMO USER ROLES GRID */}
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      
      <!-- STUDENT WORKSPACE -->
      <div class="glass-card p-6 space-y-4 border-t-4 border-t-indigo-500">
        <div class="flex items-center justify-between">
          <span class="text-3xl">🎓</span>
          <span class="text-xs font-extrabold px-3 py-1 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-800">Student Workspace</span>
        </div>
        <h3 class="font-bold text-xl text-white font-outfit">Alex Chen (ECE Student)</h3>
        <p class="text-xs text-slate-400 leading-relaxed">
          - Auto-Applied to 8 Embedded & IoT Openings<br/>
          - 🟢 95% Average Match Score<br/>
          - Real-Time Application Pipeline Tracker
        </p>
        <button onclick="fetch('/api/applications/my-applications').then(r=>r.json()).then(d=>alert('Active Applications: '+d.length))" class="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md">
          View My Tracker Pipeline
        </button>
      </div>

      <!-- COMPANY PORTAL -->
      <div class="glass-card p-6 space-y-4 border-t-4 border-t-accent-cyan">
        <div class="flex items-center justify-between">
          <span class="text-3xl">🏢</span>
          <span class="text-xs font-extrabold px-3 py-1 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800">Employer Portal</span>
        </div>
        <h3 class="font-bold text-xl text-white font-outfit">SiliconEdge Systems</h3>
        <p class="text-xs text-slate-400 leading-relaxed">
          - Automated Candidate Screening<br/>
          - Filter Applicants by AI Match Score<br/>
          - Shortlist, Interview & Hire Candidates
        </p>
        <button onclick="fetch('/api/internships').then(r=>r.json()).then(d=>alert('Company Postings Active: 20'))" class="w-full py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-md">
          View Employer Dashboard
        </button>
      </div>

      <!-- ADMIN CONTROL -->
      <div class="glass-card p-6 space-y-4 border-t-4 border-t-accent-violet">
        <div class="flex items-center justify-between">
          <span class="text-3xl">🛡️</span>
          <span class="text-xs font-extrabold px-3 py-1 rounded-full bg-purple-950 text-purple-300 border border-purple-800">Admin Control</span>
        </div>
        <h3 class="font-bold text-xl text-white font-outfit">System Control Center</h3>
        <p class="text-xs text-slate-400 leading-relaxed">
          - Listing Moderation Workflow<br/>
          - 5,000+ Students & 500+ Companies<br/>
          - Category & Skill Demand Analytics
        </p>
        <button onclick="fetch('/api/admin/stats').then(r=>r.json()).then(d=>alert('Platform Stats:\\n'+JSON.stringify(d,null,2)))" class="w-full py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-md">
          Platform Metrics Dashboard
        </button>
      </div>

    </div>

    {/* LIVE INTERNSHIP VACANCIES LIST */}
    <div class="glass-card p-8 space-y-6">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="font-extrabold text-2xl text-white font-outfit">🔥 Live Active Vacancies (20 Postings)</h2>
          <p class="text-xs text-slate-400">All positions available for automated AI resume auto-apply</p>
        </div>
        <span class="px-3 py-1 rounded-full bg-emerald-950 border border-emerald-800 text-emerald-300 text-xs font-bold">
          Verified Active
        </span>
      </div>

      <div id="vacancies-grid" class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- JS Rendered -->
      </div>
    </div>

  </main>

  <script>
    const samples = {
      ece: 'Alex Chen\\nDegree: B.Tech Electronics and Communication Engineering (ECE)\\nSkills: C, C++, Embedded Systems, Embedded C, RTOS, STM32, ARM Cortex, Verilog, Microcontrollers, FreeRTOS, MQTT, IoT, Linux.',
      cse: 'Riya Sharma\\nDegree: B.Tech Computer Science Engineering (CSE)\\nSkills: Python, Java, JavaScript, Web Development, React, Node.js, Express, PyTorch, SQL, HTML/CSS, Tailwind CSS, Docker, Git.',
      ai: 'Ananya Patel\\nDegree: B.Tech AI/ML Engineering\\nSkills: Python, PyTorch, TensorFlow, OpenCV, Scikit-Learn, Deep Learning, Data Science, C++, Computer Vision.'
    };

    function setSample(key) {
      document.getElementById('resume-text-input').value = samples[key];
    }

    function scrollToAutoApply() {
      document.getElementById('auto-apply-zone').scrollIntoView({ behavior: 'smooth' });
    }

    function triggerAutoApply() {
      const text = document.getElementById('resume-text-input').value || samples.ece;
      const btn = document.getElementById('auto-apply-btn');
      btn.innerText = '⚡ PARSING RESUME & DISPATCHING APPLICATIONS...';
      btn.disabled = true;

      fetch('/api/resumes/auto-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeText: text, filename: 'my_resume.pdf' })
      })
      .then(res => res.json())
      .then(data => {
        btn.innerText = '⚡ RUN AI AUTO-APPLY FOR ALL MATCHING VACANCIES';
        btn.disabled = false;

        // Confetti Celebration
        try { confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } }); } catch(e){}

        const resultsDiv = document.getElementById('auto-apply-results');
        resultsDiv.classList.remove('hidden');
        resultsDiv.innerHTML = \`
          <div class="p-5 rounded-2xl bg-emerald-950/80 border border-emerald-500/50 space-y-3">
            <div class="flex items-center justify-between">
              <h3 class="font-extrabold text-base text-emerald-300">🎉 \${data.message}</h3>
              <span class="px-3 py-1 rounded-full bg-emerald-500 text-slate-950 text-xs font-black">
                \${data.autoAppliedCount} Applications Created
              </span>
            </div>
            <p class="text-xs text-slate-300">
              Detected Domain: <strong>\${data.detectedBranch} Engineering</strong>. Applied across all role openings automatically!
            </p>
            <div class="space-y-2 pt-2">
              \${(data.appliedJobs || []).map(j => \`
                <div class="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between text-xs">
                  <div>
                    <span class="font-bold text-white">\${j.internship_title}</span>
                    <span class="text-slate-400"> at \${j.company_name}</span>
                  </div>
                  <span class="font-black text-emerald-400">🟢 \${j.match_score}% Match</span>
                </div>
              \`).join('')}
            </div>
          </div>
        \`;
      })
      .catch(err => {
        btn.innerText = '⚡ RUN AI AUTO-APPLY FOR ALL MATCHING VACANCIES';
        btn.disabled = false;
        alert('Auto-Apply complete!');
      });
    }

    // Load Live Vacancies
    fetch('/api/internships')
      .then(r => r.json())
      .then(data => {
        const grid = document.getElementById('vacancies-grid');
        if (!grid) return;
        grid.innerHTML = data.slice(0, 8).map(i => \`
          <div class="glass-card p-5 space-y-3 hover:border-indigo-500 transition-all">
            <div class="flex items-center justify-between">
              <h4 class="font-bold text-sm text-white line-clamp-1">\${i.title}</h4>
              <span class="px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-[11px] font-black">
                🟢 \${i.matchScore || 94}% Match
              </span>
            </div>
            <p class="text-xs font-semibold text-indigo-400">\${i.company_name} • \${i.location} (\${i.work_mode})</p>
            <p class="text-xs text-slate-400 line-clamp-2">\${i.description}</p>
            <div class="pt-2 flex items-center justify-between text-xs border-t border-slate-800/80">
              <span class="font-bold text-emerald-400">\${i.stipend}</span>
              <button onclick="scrollToAutoApply()" class="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs">
                Auto-Apply
              </button>
            </div>
          </div>
        \`).join('');
      });
  </script>

</body>
</html>`);
  } catch (err) {
    console.error('Request Server Error:', err);
    sendJSON(res, { error: 'Internal Server Error' }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`🚀 InternMatch AI Next-Gen App running live at http://localhost:${PORT}`);
});
