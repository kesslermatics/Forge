import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LoginForm from './components/LoginForm';
import RegisterForm from './components/RegisterForm';
import AppLayout from './components/AppLayout';
import Dashboard from './components/Dashboard';
import ChatPage from './components/ChatPage';
import NutritionPage from './components/NutritionPage';
import SetupPage from './components/SetupPage';
import SettingsPage from './components/SettingsPage';
import ForgePlanPage from './components/ForgePlanPage';
import ForgeSessionPage from './components/ForgeSessionPage';
import ForgeExerciseHistoryPage from './components/ForgeExerciseHistoryPage';
import ForgeProgressPhotosPage from './components/ForgeProgressPhotosPage';
import PreviewShowcase from './preview/PreviewShowcase';

function App() {
  return <BrowserRouter><Routes>
    <Route path="/login" element={<LoginForm />} />
    <Route path="/register" element={<RegisterForm />} />
    <Route path="/preview" element={<PreviewShowcase />} />
    <Route element={<AppLayout />}>
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/chat" element={<ChatPage />} />
      <Route path="/nutrition" element={<NutritionPage />} />
      <Route path="/achievements" element={<Navigate to="/dashboard" replace />} />
      <Route path="/forge" element={<ForgePlanPage />} />
      <Route path="/forge/progress" element={<ForgeProgressPhotosPage />} />
      <Route path="/forge/session/:sessionId" element={<ForgeSessionPage />} />
      <Route path="/forge/exercises/:exerciseId/history" element={<ForgeExerciseHistoryPage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/settings" element={<SettingsPage />} />
    </Route>
    <Route path="*" element={<Navigate to="/login" replace />} />
  </Routes></BrowserRouter>;
}

export default App;
