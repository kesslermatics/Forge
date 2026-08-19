import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LoginForm from './components/LoginForm';
import RegisterForm from './components/RegisterForm';
import AppLayout from './components/AppLayout';
import Dashboard from './components/Dashboard';
import NutritionPage from './components/NutritionPage';
import AchievementsTab from './components/AchievementsTab';
import SetupPage from './components/SetupPage';
import SettingsPage from './components/SettingsPage';
import ForgePlanPage from './components/ForgePlanPage';
import ForgeSessionPage from './components/ForgeSessionPage';
import ForgeExerciseHistoryPage from './components/ForgeExerciseHistoryPage';
import PreviewShowcase from './preview/PreviewShowcase';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<LoginForm />} />
        <Route path="/register" element={<RegisterForm />} />

        {/* Design preview — 6 redesign concepts, mock data, no auth */}
        <Route path="/preview" element={<PreviewShowcase />} />

        {/* Protected routes (AppLayout checks auth + redirects to /setup if needed) */}
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/nutrition" element={<NutritionPage />} />
          <Route path="/achievements" element={<AchievementsTab />} />
          <Route path="/forge" element={<ForgePlanPage />} />
          <Route path="/forge/session/:sessionId" element={<ForgeSessionPage />} />
          <Route path="/forge/exercises/:exerciseId/history" element={<ForgeExerciseHistoryPage />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
