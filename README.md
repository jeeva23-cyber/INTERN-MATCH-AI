# InternMatch AI - Full-Stack AI Student Internship Finder

**InternMatch AI** is a production-ready, full-stack web application designed to connect college students with high-value engineering and technology internships using AI resume analysis, multi-factor match scoring, and real-time application tracking.

## Key Features

- **3 User Roles**:
  - **Student**: AI Resume analysis, internship search & filters (ECE, CSE, EEE, Mech, Civil, AI/ML, Embedded, IoT), save internships, apply with custom cover note, track application pipeline (`Applied` $\rightarrow$ `Shortlisted` $\rightarrow$ `Interview` $\rightarrow$ `Selected`/`Rejected`).
  - **Company**: Post & manage internships, review student applications with AI match percentage breakdown, view uploaded student resumes, transition status.
  - **Admin**: Approve/reject company postings, delete fake/expired listings, manage user accounts, platform performance metrics with charts.

- **AI Resume Matcher Engine**:
  - Auto-extracts skills, education, experience, and programming languages from uploaded resumes (PDF/DOCX/TXT).
  - Calculates dynamic **Match Percentage**:
    $$\text{Match Score} = \text{Skills (40\%)} + \text{Branch (25\%)} + \text{Location (15\%)} + \text{Experience (15\%)} + \text{Interests (5\%)}$$
  - Provides actionable feedback: detected skills, missing skills, strong matches, and recommended skills to learn.

- **Full-Stack Architecture**:
  - **Backend**: Express REST API + SQLite Database with pre-populated seed data.
  - **Frontend**: React 18 + Vite + Tailwind CSS + Lucide Icons + Recharts/SVG Analytics + Dark/Light Theme.

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Seed the database with 10 students, 10 companies, 20 internships, and 20 applications:
   ```bash
   npm run seed
   ```

3. Run the development server (Frontend + Backend proxy):
   ```bash
   # Terminal 1: Start Backend API (Port 5000)
   npm run server

   # Terminal 2: Start Vite Dev Server (Port 5173)
   npm run dev
   ```

4. Quick Demo Login Credentials:
   - **Student**: `alex@student.edu` / `password123`
   - **Company**: `hr@siliconedge.com` / `password123`
   - **Admin**: `admin@internmatch.ai` / `admin123`
   *(1-Click Login buttons are available on the Login page!)*
