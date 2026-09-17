import React from 'react';
import { AuthProvider } from './context/AuthContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { DataProvider } from './context/DataContext.jsx';
import { AppRoutes } from './routes/AppRoutes.jsx';
import { Toast } from './components/common/Toast.jsx';

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <DataProvider>
          <AppRoutes />
          <Toast />
        </DataProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
