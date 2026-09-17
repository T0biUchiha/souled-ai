import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from './shell';
import { HomePage, NotFoundPage } from '../features/home/pages';

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
