import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './styles.css'
import Shell from './components/Shell'
import Today from './pages/Today'
import Students from './pages/Students'
import StudentPage from './pages/Student'
import Assignments from './pages/Assignments'
import AssignmentPage from './pages/Assignment'
import Compare from './pages/Compare'
import Review from './pages/Review'

const router = createBrowserRouter([
  {
    path: '/',
    element: <Shell />,
    children: [
      { index: true, element: <Today /> },
      { path: 'students', element: <Students /> },
      { path: 'students/:code', element: <StudentPage /> },
      { path: 'assignments', element: <Assignments /> },
      { path: 'assignments/:code', element: <AssignmentPage /> },
      { path: 'compare', element: <Compare /> },
      { path: 'review', element: <Review /> },
    ],
  },
])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
)
