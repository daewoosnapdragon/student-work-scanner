import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import './styles.css'
import Shell from './components/Shell'
import Scan from './pages/Scan'
import Loose from './pages/Loose'
import PileCheck from './pages/PileCheck'
import ScanLog from './pages/ScanLog'
import Students from './pages/Students'
import StudentPage from './pages/Student'
import Assignments from './pages/Assignments'
import AssignmentPage from './pages/Assignment'
import Compare from './pages/Compare'
import SettingsPage from './pages/Settings'

const router = createBrowserRouter([
  {
    path: '/',
    element: <Shell />,
    children: [
      // one route serves the Scan screen, so its tab lights up from the start
      { index: true, element: <Navigate to="/scan" replace /> },
      { path: 'scan', element: <Scan /> },
      { path: 'scan/log', element: <ScanLog /> },
      { path: 'scan/pile/:id', element: <PileCheck /> },
      { path: 'scan/loose', element: <Loose /> },
      { path: 'today', element: <Navigate to="/scan" replace /> },
      { path: 'students', element: <Students /> },
      { path: 'students/:code', element: <StudentPage /> },
      { path: 'assignments', element: <Assignments /> },
      { path: 'assignments/:code', element: <AssignmentPage /> },
      { path: 'compare', element: <Compare /> },
      { path: 'review', element: <Navigate to="/scan" replace /> },
      { path: 'review/stack', element: <Navigate to="/scan" replace /> },
      { path: 'review/sort', element: <Navigate to="/scan/loose" replace /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
)
