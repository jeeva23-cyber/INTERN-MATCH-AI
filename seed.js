import { db } from './database.js';
import { seedUsers, seedStudentProfiles, seedCompanies, seedInternships, seedApplications, seedSavedInternships } from '../src/mock/seedData.js';

export function runSeed() {
  console.log('🌱 Seeding InternMatch AI Database...');
  db.reset({
    users: seedUsers,
    student_profiles: seedStudentProfiles,
    companies: seedCompanies,
    internships: seedInternships,
    applications: seedApplications,
    saved_internships: seedSavedInternships,
    resumes: []
  });
  console.log('✅ Database successfully populated with 10 students, 10 companies, 20 internships, and 20 applications!');
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('seed.js')) {
  runSeed();
}
